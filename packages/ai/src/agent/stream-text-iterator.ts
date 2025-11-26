import type {
  LanguageModelV2,
  LanguageModelV2Prompt,
  LanguageModelV2ToolCall,
  LanguageModelV2ToolResultPart,
  SharedV2ProviderOptions,
} from '@ai-sdk/provider';
import type {
  StepResult,
  StreamTextOnStepFinishCallback,
  UIMessageChunk,
} from 'ai';
import { doStreamStep, type ModelStopCondition } from './do-stream-step.js';
import type { DurableAgentToolSet } from './durable-agent.js';
import { toolsToModelTools } from './tools-to-model-tools.js';

// This runs in the workflow context
export async function* streamTextIterator({
  prompt,
  tools = {},
  writable,
  model,
  providerOptions,
  stopConditions,
  sendStart = true,
  onStepFinish,
}: {
  prompt: LanguageModelV2Prompt;
  tools: DurableAgentToolSet;
  writable: WritableStream<UIMessageChunk>;
  model: string | (() => Promise<LanguageModelV2>);
  providerOptions?: SharedV2ProviderOptions;
  stopConditions?: ModelStopCondition[] | ModelStopCondition;
  sendStart?: boolean;
  onStepFinish?: StreamTextOnStepFinishCallback<any>;
}): AsyncGenerator<
  LanguageModelV2ToolCall[],
  LanguageModelV2Prompt,
  LanguageModelV2ToolResultPart[]
> {
  const conversationPrompt = [...prompt]; // Create a mutable copy

  const steps: StepResult<any>[] = [];
  let done = false;
  let isFirstIteration = true;

  while (!done) {
    const { toolCalls, providerToolResults, finish, step } = await doStreamStep(
      conversationPrompt,
      model,
      writable,
      toolsToModelTools(tools),
      {
        providerOptions,
        sendStart: sendStart && isFirstIteration,
      }
    );
    isFirstIteration = false;
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
        clientToolResults = yield clientToolCalls;
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
