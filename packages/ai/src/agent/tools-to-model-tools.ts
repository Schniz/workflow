import type {
  LanguageModelV2FunctionTool,
  LanguageModelV2ProviderDefinedTool,
} from '@ai-sdk/provider';
import { asSchema, type ToolSet } from 'ai';

/**
 * A provider-defined tool configuration.
 * These tools are executed by the provider (e.g., Anthropic's computer use)
 * rather than client-side.
 */
export interface ProviderDefinedTool {
  type: 'provider-defined';
  /**
   * The ID of the tool. Should follow the format `<provider-name>.<unique-tool-name>`.
   */
  id: `${string}.${string}`;
  /**
   * Optional description of the tool.
   */
  description?: string;
  /**
   * The arguments for configuring the tool.
   */
  args?: Record<string, unknown>;
}

type ToolEntry = ToolSet[string] | ProviderDefinedTool;

function isProviderDefinedTool(tool: ToolEntry): tool is ProviderDefinedTool {
  return (
    typeof tool === 'object' &&
    tool !== null &&
    'type' in tool &&
    tool.type === 'provider-defined'
  );
}

export function toolsToModelTools(
  tools: Record<string, ToolEntry>
): Array<LanguageModelV2FunctionTool | LanguageModelV2ProviderDefinedTool> {
  return Object.entries(tools).map(([name, tool]) => {
    if (isProviderDefinedTool(tool)) {
      return {
        type: 'provider-defined' as const,
        id: tool.id,
        name,
        args: tool.args ?? {},
      };
    }

    // User-defined function tool
    return {
      type: 'function' as const,
      name,
      description: tool.description,
      inputSchema: asSchema(tool.inputSchema).jsonSchema,
    };
  });
}
