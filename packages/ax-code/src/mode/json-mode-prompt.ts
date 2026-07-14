/**
 * Helpers for structured generateObject fan-out.
 *
 * Some OpenAI-compatible providers (notably Alibaba/Qwen) reject
 * `response_format: json_object` unless the prompt contains the literal word
 * "json" in some form. AI SDK `generateObject` uses that response format, so
 * ensemble tools must satisfy the requirement automatically.
 */

/** True when any message body already contains the word "json" (case-insensitive). */
export function messagesContainJsonWord(messages: readonly string[]): boolean {
  return messages.some((text) => /\bjson\b/i.test(text))
}

/**
 * Append a short instruction that includes the required word "json" when missing.
 * Idempotent: if the text already contains "json", returns it unchanged.
 */
export function ensureJsonModeInstruction(text: string): string {
  if (messagesContainJsonWord([text])) return text
  // Use lowercase "json" — some providers match the word literally / case-sensitively.
  return `${text.trimEnd()}\n\nRespond with a single json object matching the required schema.`
}
