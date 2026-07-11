const STORAGE_KEY = "oc.chat.recentPrompts"
const MAX_PROMPTS = 8
const MAX_PROMPT_LENGTH = 500

function readAll(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, MAX_PROMPTS)
  } catch {
    return []
  }
}

function writeAll(prompts: string[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts.slice(0, MAX_PROMPTS)))
  } catch {
    // Ignore quota / private mode failures.
  }
}

/** Persist a user prompt for the recent-prompts chip row (newest first, de-duped). */
export function recordRecentPrompt(text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  const value = trimmed.length > MAX_PROMPT_LENGTH ? `${trimmed.slice(0, MAX_PROMPT_LENGTH)}…` : trimmed
  const existing = readAll().filter((item) => item !== value)
  writeAll([value, ...existing])
}

export function listRecentPrompts(): string[] {
  return readAll()
}

export function clearRecentPrompts(): void {
  writeAll([])
}
