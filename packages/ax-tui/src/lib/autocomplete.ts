import { readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

/** Offsets are JavaScript UTF-16 indices, not terminal cells or native display-width offsets. */
export interface AutocompleteRequest {
  text: string
  cursor: number
}

export interface AutocompleteItem {
  label: string
  insertText: string
  /** Optional UTF-16 caret offset inside insertText (for example, before a closing quote). */
  cursorOffset?: number
  description?: string
}

export interface AutocompleteResult {
  /** The exact input snapshot for which these suggestions were computed. */
  request: AutocompleteRequest
  start: number
  end: number
  items: readonly AutocompleteItem[]
}

export type AutocompleteProvider = (
  request: AutocompleteRequest,
  signal: AbortSignal,
) => AutocompleteResult | null | Promise<AutocompleteResult | null>

function validOffset(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return false
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff)
}

function validateRequest(request: AutocompleteRequest): void {
  if (!validOffset(request.text, request.cursor)) throw new RangeError("Invalid autocomplete cursor")
}

function sameRequest(a: AutocompleteRequest, b: AutocompleteRequest): boolean {
  return a.text === b.text && a.cursor === b.cursor
}

/** Replace only the provider's token range, preserving the rest of the input. Reject stale results. */
export function applyAutocomplete(
  request: AutocompleteRequest,
  result: AutocompleteResult,
  item: AutocompleteItem,
): AutocompleteRequest | null {
  validateRequest(request)
  if (!sameRequest(request, result.request) || !result.items.includes(item)) return null
  if (
    !validOffset(request.text, result.start) ||
    !validOffset(request.text, result.end) ||
    result.start > request.cursor ||
    result.end < request.cursor
  ) {
    throw new RangeError("Invalid autocomplete replacement range")
  }
  const cursorOffset = item.cursorOffset ?? item.insertText.length
  if (!validOffset(item.insertText, cursorOffset)) throw new RangeError("Invalid autocomplete item cursor")
  return {
    text: request.text.slice(0, result.start) + item.insertText + request.text.slice(result.end),
    cursor: result.start + cursorOffset,
  }
}

/** Cancel superseded requests and ignore providers that resolve after cancellation. */
export class AutocompleteController {
  private pending?: AbortController
  private disposed = false

  constructor(private readonly provider: AutocompleteProvider) {}

  async request(request: AutocompleteRequest): Promise<AutocompleteResult | null> {
    if (this.disposed) return null
    validateRequest(request)
    const snapshot = Object.freeze({ ...request })
    const previous = this.pending
    const pending = new AbortController()
    // Reserve this request before aborting: abort listeners can request again or dispose us.
    this.pending = pending
    previous?.abort()
    if (this.disposed || pending.signal.aborted || this.pending !== pending) return null
    try {
      const result = await this.provider(snapshot, pending.signal)
      if (pending.signal.aborted || this.pending !== pending) return null
      if (result && !sameRequest(snapshot, result.request)) {
        throw new Error("Autocomplete provider returned a stale result")
      }
      return result
    } catch (error) {
      if (pending.signal.aborted) return null
      throw error
    } finally {
      if (this.pending === pending) this.pending = undefined
    }
  }

  cancel(): void {
    const pending = this.pending
    this.pending = undefined
    pending?.abort()
  }

  dispose(): void {
    this.disposed = true
    this.cancel()
  }
}

export interface SlashCommand {
  name: string
  description?: string
}

/** Complete the leading slash-command token; command arguments belong to other providers. */
export function createSlashCommandProvider(commands: readonly SlashCommand[]): AutocompleteProvider {
  const entries = commands.map((command) => {
    if (!command.name || /[\s/]/u.test(command.name)) {
      throw new Error("Slash command names must be single bare tokens")
    }
    return { ...command }
  })
  return (request, signal) => {
    validateRequest(request)
    if (signal.aborted || request.cursor === 0 || !request.text.startsWith("/")) return null
    const end = request.text.search(/\s/u)
    const tokenEnd = end < 0 ? request.text.length : end
    if (request.cursor > tokenEnd) return null
    const prefix = request.text.slice(1, request.cursor).toLowerCase()
    const items = entries
      .filter((command) => command.name.toLowerCase().startsWith(prefix))
      .map((command) => ({
        label: `/${command.name}`,
        insertText: `/${command.name}`,
        description: command.description,
      }))
    return { request: { ...request }, start: 0, end: tokenEnd, items }
  }
}

export interface FilePathAutocompleteOptions {
  /** Resolved at provider creation, so later process.chdir calls cannot change the search base. */
  cwd?: string
  home?: string
  includeHidden?: boolean
  maxResults?: number
}

/**
 * Complete a whitespace-delimited path or @path. Double-quoted paths support spaces.
 * Backslashes are literal path characters (including Windows separators), not shell escapes.
 */
export function createFilePathProvider(options: FilePathAutocompleteOptions = {}): AutocompleteProvider {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const home = options.home ?? homedir()
  const limit = options.maxResults ?? 100
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("maxResults must be a positive integer")

  return async (request, signal) => {
    validateRequest(request)
    if (signal.aborted) return null
    // Scan tokens rather than splitting at the cursor: replacement must consume the suffix too.
    const tokens = /@?"[^"\r\n]*(?:"|$)|[^\s"]+/gu
    let match: RegExpExecArray | null
    let token: { text: string; start: number; end: number } | undefined
    while ((match = tokens.exec(request.text))) {
      const end = match.index + match[0].length
      if (match.index <= request.cursor && request.cursor <= end) {
        token = { text: match[0], start: match.index, end }
        break
      }
    }
    if (!token) return null
    const mention = token.text.startsWith("@") ? "@" : ""
    const quoted = token.text[mention.length] === '"'
    const contentStart = token.start + mention.length + Number(quoted)
    const contentEnd = token.end - Number(quoted && token.text.endsWith('"') && token.end > contentStart)
    if (request.cursor < contentStart) return null
    const prefix = request.text.slice(contentStart, Math.min(request.cursor, contentEnd))
    if (!prefix && !mention && !quoted) return null
    const separator = process.platform === "win32" ? /[\\/]/u : /\//u
    let slash = -1
    for (let index = 0; index < prefix.length; index++) if (separator.test(prefix[index])) slash = index
    const directory = prefix.slice(0, slash + 1)
    const name = prefix.slice(slash + 1)
    const expanded = directory.startsWith("~/") || directory.startsWith("~\\")
      ? path.join(home, directory.slice(2))
      : directory
    let entries
    try {
      entries = await readdir(path.resolve(cwd, expanded || "."), { withFileTypes: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ""
      if (signal.aborted || ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(code)) {
        return null
      }
      throw error
    }
    if (signal.aborted) return null
    const matches = entries
      .filter((entry) => entry.name.startsWith(name))
      .filter((entry) => options.includeHidden || name.startsWith(".") || !entry.name.startsWith("."))
      // Reject names that cannot be represented by this token syntax or safely displayed in a terminal.
      .filter((entry) => !/["\x00-\x1f\x7f-\x9f]/u.test(entry.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, limit)
    const items = await Promise.all(
      matches.map(async (entry) => {
        let isDirectory = entry.isDirectory()
        if (entry.isSymbolicLink() && !signal.aborted) {
          try {
            isDirectory = (await stat(path.resolve(cwd, expanded || ".", entry.name))).isDirectory()
          } catch {
            // Broken or inaccessible symlinks remain selectable, but are not advertised as directories.
          }
        }
        const suffix = isDirectory ? (directory.endsWith("\\") ? "\\" : "/") : ""
        const value = directory + entry.name + suffix
        const needsQuotes = quoted || /\s/u.test(value)
        const insertText = needsQuotes ? `${mention}"${value}"` : mention + value
        return {
          label: entry.name + suffix,
          insertText,
          cursorOffset: needsQuotes && isDirectory ? insertText.length - 1 : insertText.length,
          description: isDirectory ? "Directory" : entry.isSymbolicLink() ? "Symbolic link" : "File",
        }
      }),
    )
    if (signal.aborted) return null
    items.sort((a, b) =>
      Number(b.description === "Directory") - Number(a.description === "Directory") || a.label.localeCompare(b.label),
    )
    return { request: { ...request }, start: token.start, end: token.end, items }
  }
}

/** First provider that recognizes the input wins, even when its item list is empty. */
export function combineAutocompleteProviders(...providers: AutocompleteProvider[]): AutocompleteProvider {
  return async (request, signal) => {
    for (const provider of providers) {
      if (signal.aborted) return null
      const result = await provider(request, signal)
      if (signal.aborted) return null
      if (result) return result
    }
    return null
  }
}
