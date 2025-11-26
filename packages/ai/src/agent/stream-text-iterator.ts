import type {
  LanguageModelV2,
  LanguageModelV2Prompt,
  LanguageModelV2ToolCall,
  LanguageModelV2ToolResultPart,
} from '@ai-sdk/provider';
import type {
  StepResult,
  StreamTextOnStepFinishCallback,
  UIMessageChunk,
} from 'ai';
import { doStreamStep, type ModelStopCondition } from './do-stream-step.js';
import type {
  DurableAgentToolSet,
  PrepareStepCallback,
} from './durable-agent.js';
import { toolsToModelTools } from './tools-to-model-tools.js';

/**
 * The value yielded by the stream text iterator when tool calls are requested.
 * Contains both the tool calls and the current conversation messages.
 */
export interface StreamTextIteratorYieldValue {
  /** The tool calls requested by the model */
  toolCalls: LanguageModelV2ToolCall[];
  /** The conversation messages up to (and including) the tool call request */
  messages: LanguageModelV2Prompt;
}

// This runs in the workflow context
export async function* streamTextIterator({
  prompt,
  tools = {},
  writable,
  model,
  stopConditions,
  sendStart = true,
  onStepFinish,
  prepareStep,
}: {
  prompt: LanguageModelV2Prompt;
  tools: DurableAgentToolSet;
  writable: WritableStream<UIMessageChunk>;
  model: string | (() => Promise<LanguageModelV2>);
  stopConditions?: ModelStopCondition[] | ModelStopCondition;
  sendStart?: boolean;
  onStepFinish?: StreamTextOnStepFinishCallback<any>;
  prepareStep?: PrepareStepCallback<any>;
}): AsyncGenerator<
  StreamTextIteratorYieldValue,
  LanguageModelV2Prompt,
  LanguageModelV2ToolResultPart[]
> {
  let conversationPrompt = [...prompt]; // Create a mutable copy
  let currentModel = model;

  const steps: StepResult<any>[] = [];
  let done = false;
  let isFirstIteration = true;
  let stepNumber = 0;

  while (!done) {
    // Call prepareStep callback before each step if provided
    if (prepareStep) {
      const prepareResult = await prepareStep({
        model: currentModel,
        stepNumber,
        steps,
        messages: conversationPrompt,
      });

      // Apply any overrides from prepareStep
      if (prepareResult.model !== undefined) {
        currentModel = prepareResult.model;
      }
      if (prepareResult.messages !== undefined) {
        conversationPrompt = [...prepareResult.messages];
      }
    }

    const { toolCalls, providerToolResults, finish, step } = await doStreamStep(
      conversationPrompt,
      currentModel,
      writable,
      toolsToModelTools(tools),
      {
        sendStart: sendStart && isFirstIteration,
      }
    );
    isFirstIteration = false;
    stepNumber++;
    steps.push(step);

    if (finish?.finishReason === 'tool-calls') {
      // Add assistant message with tool calls to the conversation
      conversationPrompt.push({
        role: 'assistant',
        content: toolCalls.map((toolCall) => ({
          type: 'tool-call',
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: JSON.parse(toolCall.input),
        })),
      });

      // Filter to only client-executed tool calls (not provider-executed)
      const clientToolCalls = toolCalls.filter(
        (toolCall) => !toolCall.providerExecuted
      );

      // Get client tool results by yielding only the client tool calls
      let clientToolResults: LanguageModelV2ToolResultPart[] = [];
      if (clientToolCalls.length > 0) {
        // Yield the tool calls along with the current conversation messages
        // This allows executeTool to pass the conversation context to tool execute functions
        clientToolResults = yield {
          toolCalls: clientToolCalls,
          messages: conversationPrompt,
        };
        await writeToolOutputToUI(writable, clientToolResults);
      }

      // Merge provider tool results with client tool results
      const allToolResults = [...providerToolResults, ...clientToolResults];

      conversationPrompt.push({
        role: 'tool',
        content: allToolResults,
      });

      if (stopConditions) {
        const stopConditionList = Array.isArray(stopConditions)
          ? stopConditions
          : [stopConditions];
        if (stopConditionList.some((test) => test({ steps }))) {
          done = true;
        }
      }
    } else if (finish?.finishReason === 'stop') {
      // Add assistant message with text content to the conversation
      const textContent = step.content.filter(
        (item) => item.type === 'text'
      ) as Array<{ type: 'text'; text: string }>;

      if (textContent.length > 0) {
        conversationPrompt.push({
          role: 'assistant',
          content: textContent,
        });
      }

      done = true;
    } else {
      throw new Error(`Unexpected finish reason: ${finish?.finishReason}`);
    }

    if (onStepFinish) {
      await onStepFinish(step);
    }
  }

  return conversationPrompt;
}

async function writeToolOutputToUI(
  writable: WritableStream<UIMessageChunk>,
  toolResults: LanguageModelV2ToolResultPart[]
) {
  'use step';

  const writer = writable.getWriter();
  try {
    for (const result of toolResults) {
      await writer.write({
        type: 'tool-output-available',
        toolCallId: result.toolCallId,
        output: JSON.stringify(result) ?? '',
      });
    }
  } finally {
    writer.releaseLock();
  }
}
