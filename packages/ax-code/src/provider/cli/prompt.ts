import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

export interface CliPromptOptions {
  providerID?: string
}

const WEB_SEARCH_CLI_PROVIDERS = new Set(["claude-code", "codex-cli", "gemini-cli"])

const CLI_WEB_SEARCH_HINT = [
  "<cli_web_search>",
  "You are running inside a CLI assistant that has built-in web search or web fetch capability.",
  [
    "When the user's task depends on current, recent, external, or otherwise unverifiable-from-repo information,",
    "use your built-in web search or web fetch capability to look it up online before answering.",
  ].join(" "),
  [
    "Do not claim that you cannot access the internet when web search is available.",
    "Cite the sources you used when summarizing online information.",
  ].join(" "),
  "</cli_web_search>",
].join("\n")

export function promptToText(prompt: LanguageModelV3Prompt, options: CliPromptOptions = {}): string {
  const parts: string[] = []

  if (options.providerID && WEB_SEARCH_CLI_PROVIDERS.has(options.providerID)) parts.push(CLI_WEB_SEARCH_HINT)

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
      const chunks: string[] = []
      for (const p of message.content) {
        if (p.type === "text") chunks.push(p.text)
        else if (p.type === "reasoning") chunks.push(p.text)
        else if (p.type === "tool-call") chunks.push(`[Tool: ${p.toolName}(${JSON.stringify(p.input)})]`)
      }
      if (chunks.length) parts.push(`[Assistant]: ${chunks.join("\n")}`)
    } else if (message.role === "tool") {
      const text = message.content
        .filter((p): p is Extract<typeof p, { type: "tool-result" }> => p.type === "tool-result")
        .map((p) => `[Tool Result: ${p.toolName}]: ${JSON.stringify(p.output)}`)
        .join("\n")
      if (text) parts.push(text)
    }
  }

  return parts.join("\n\n")
}
