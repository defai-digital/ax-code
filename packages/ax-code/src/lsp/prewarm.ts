import path from "path"
import { LANGUAGE_EXTENSIONS } from "./language"
import type { PrewarmSelectionOptions } from "./selection"

export function detectLanguage(file: string): string {
  const extension = path.parse(file).ext || file
  return LANGUAGE_EXTENSIONS[extension] ?? "unknown"
}

export function selectFiles(files: string[], opts: PrewarmSelectionOptions = {}): string[] {
  const maxFiles = Math.max(0, opts.maxFiles ?? files.length)
  const maxLanguages = Math.max(0, opts.maxLanguages ?? maxFiles)
  if (maxFiles === 0 || maxLanguages === 0) return []

  const selected: string[] = []
  const seenLanguages = new Set<string>()

  for (const file of files) {
    if (selected.length >= maxFiles || seenLanguages.size >= maxLanguages) break

    const language = detectLanguage(file)
    if (language === "unknown" || language === "plaintext") continue
    if (seenLanguages.has(language)) continue

    selected.push(file)
    seenLanguages.add(language)
  }

  return selected
}
