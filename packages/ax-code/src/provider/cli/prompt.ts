import type { LanguageModelV2Prompt } from "@ai-sdk/provider"

export function promptToText(prompt: LanguageModelV2Prompt): string {
  const parts: string[] = []

  for (const message of prompt) {
    if (message.role === "system") {
      parts.push(message.content)
    } else if (message.role === "user") {
      const text = message.content
        .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n")
      if (text) parts.push(text)
    } else if (message.role === "assistant") {
      const text = message.content
        .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n")
      if (text) parts.push(`[Assistant]: ${text}`)
    } else if (message.role === "tool") {
      const text = message.content
        .map((p) => `[Tool Result: ${p.toolName}]: ${JSON.stringify(p.output)}`)
        .join("\n")
      if (text) parts.push(text)
    }
  }

  return parts.join("\n\n")
}
