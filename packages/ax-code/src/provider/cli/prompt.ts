import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { toErrorMessage } from "@/util/error-message"
import type { CliAttachmentRef } from "./attachments"

export interface CliPromptOptions {
  providerID?: string
  attachments?: CliAttachmentRef[]
}

const WEB_SEARCH_CLI_PROVIDERS = new Set(["claude-code", "codex-cli", "grok-build-cli", "kimi-cli"])

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

// CLI providers run as a one-shot subprocess per model turn: the process exits
// when the turn ends, taking every background shell/agent it started down with
// it. Agents that end a turn "waiting for the background completion
// notification" strand the task forever — the notification can never arrive
// (observed 2026-08-29: claude-code restarted dead background scans twice and
// the session could not make progress). Spell out the process model so the CLI
// agent picks a strategy that actually works.
const CLI_BACKGROUND_TASKS_HINT = [
  "<cli_background_tasks>",
  "You are running as a one-shot CLI subprocess: when this turn ends, your process exits and every",
  "background task you started (run_in_background shells, background agents) is killed with it.",
  "Completion notifications for background work are never delivered across turns.",
  "Never end a turn while background work is still pending with a promise to wait for its",
  "notification — that strands the task forever. Run blocking work in the foreground within this",
  "turn, or have background jobs write their results to files and tell the user exactly how to",
  "resume and collect them.",
  "</cli_background_tasks>",
].join("\n")

function attachmentHint(refs: CliAttachmentRef[]): string {
  const lines = refs.map((ref) => `- ${ref.path ?? ref.url} (${ref.mediaType})`)
  return [
    "<cli_attachments>",
    "The user attached the following file(s). Open and view them with your built-in file/image tools" +
      " (read the local paths, fetch the URLs) before answering — do not claim you cannot see attachments.",
    ...lines,
    "</cli_attachments>",
  ].join("\n")
}

function stringifyPromptValue(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    return (
      JSON.stringify(value, (_key, next) => {
        if (typeof next === "bigint") return next.toString()
        if (typeof next === "object" && next !== null) {
          if (seen.has(next)) return "[Circular]"
          seen.add(next)
        }
        return next
      }) ?? "null"
    )
  } catch (error) {
    return JSON.stringify({
      serialization_error: toErrorMessage(error, "Unknown serialization error"),
    })
  }
}

export function promptToText(prompt: LanguageModelV3Prompt, options: CliPromptOptions = {}): string {
  const parts: string[] = []

  if (options.providerID && WEB_SEARCH_CLI_PROVIDERS.has(options.providerID)) {
    parts.push(CLI_WEB_SEARCH_HINT)
    parts.push(CLI_BACKGROUND_TASKS_HINT)
  }
  if (options.attachments && options.attachments.length > 0) parts.push(attachmentHint(options.attachments))

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
        else if (p.type === "tool-call") chunks.push(`[Tool: ${p.toolName}(${stringifyPromptValue(p.input)})]`)
      }
      if (chunks.length) parts.push(`[Assistant]: ${chunks.join("\n")}`)
    } else if (message.role === "tool") {
      const text = message.content
        .filter((p): p is Extract<typeof p, { type: "tool-result" }> => p.type === "tool-result")
        .map((p) => `[Tool Result: ${p.toolName}]: ${stringifyPromptValue(p.output)}`)
        .join("\n")
      if (text) parts.push(text)
    }
  }

  return parts.join("\n\n")
}
