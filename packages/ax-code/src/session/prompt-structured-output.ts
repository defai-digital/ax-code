import { type Tool as AITool, tool, jsonSchema } from "ai"
import { Session } from "."
import { MessageV2 } from "./message-v2"

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  const { $schema, ...toolSchema } = input.schema

  return tool({
    id: "StructuredOutput" as any,
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as any),
    async execute(args) {
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput(result) {
      return {
        type: "text",
        value: result.output,
      }
    },
  })
}

export function createStructuredOutputTurn(format: MessageV2.OutputFormat): {
  toolChoice?: "required"
  attachTool(tools: Record<string, AITool>): void
  saveCaptured(assistant: MessageV2.Assistant): Promise<boolean>
  failIfMissing(assistant: MessageV2.Assistant): Promise<boolean>
} {
  let captured: unknown
  const required = format.type === "json_schema"
  return {
    toolChoice: required ? "required" : undefined,
    attachTool(tools) {
      if (!required) return
      tools["StructuredOutput"] = createStructuredOutputTool({
        schema: format.schema,
        onSuccess(output) {
          captured = output
        },
      })
    },
    async saveCaptured(assistant) {
      if (captured === undefined) return false
      assistant.structured = captured
      assistant.finish = assistant.finish ?? "stop"
      await Session.updateMessage(assistant)
      return true
    },
    async failIfMissing(assistant) {
      if (!required) return false
      assistant.error = new MessageV2.StructuredOutputError({
        message: "Model did not produce structured output",
        retries: 0,
      }).toObject()
      await Session.updateMessage(assistant)
      return true
    },
  }
}
