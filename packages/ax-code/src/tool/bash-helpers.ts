import os from "os"
import { WindowsSnapshotPaths } from "../snapshot/windows-paths"

/** POSIX redirections on Windows can create real Win32 device-name files. */
export function assertSupportedWindowsRedirect(word: string, shell: string, platform = process.platform) {
  if (platform !== "win32") return
  const name = shell
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.exe$/i, "")
    .toLowerCase()
  if (!name || !["bash", "sh", "dash", "zsh", "ksh"].includes(name)) return
  const target = decodeShellLiteral(word)
  if (!target || !WindowsSnapshotPaths.unsupported(target)) return
  throw new Error(
    `Unsupported Windows redirect target ${JSON.stringify(target)} in ${shell}. ` +
      "This POSIX shell can create a real reserved-name file that Git snapshots cannot restore. " +
      "Keep output visible, or use /dev/null to discard it; do not use >nul or 2>nul. " +
      "Unquoted redirects and & are interpreted by the outer shell even when the command starts with cmd /c. " +
      "For a normal output file, choose a Windows-supported filename.",
  )
}

export const DYNAMIC_REDIRECTION_DIAGNOSTIC =
  "Dynamic redirection targets are not allowed. Use literal quoted paths for stdin, stdout and stderr, " +
  "and set workdir explicitly when paths are relative to the repository root rather than the session directory. " +
  "Create output directories in a separate command first. Redirect targets must not contain $, backticks, *, ?, brackets or braces, even when quoted."

export function hasDynamicShellExpansion(value: string) {
  return /[$`*?[\]{}]/.test(value)
}

export function assertStaticRedirectTarget(target: string) {
  if (hasDynamicShellExpansion(target)) {
    throw new Error(DYNAMIC_REDIRECTION_DIAGNOSTIC)
  }
}

export function stripShellQuotes(value: string) {
  return value.replace(/^"(.*)"$|^'(.*)'$/s, "$1$2")
}

/** Decode one literal POSIX shell word without evaluating expansions. */
export function decodeShellLiteral(value: string): string | undefined {
  if (!value || value.includes("\0")) return undefined
  let quote: "single" | "double" | undefined
  let result = ""
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!
    if (quote === "single") {
      if (char === "'") quote = undefined
      else result += char
      continue
    }
    if (char === "\\") {
      const next = value[++i]
      if (next === undefined) return undefined
      if (next === "\n") continue
      if (quote === "double" && !["$", "`", '"', "\\"].includes(next)) result += "\\"
      result += next
      continue
    }
    if (char === '"') {
      quote = quote === "double" ? undefined : "double"
      continue
    }
    if (quote === undefined && char === "'") {
      quote = "single"
      continue
    }
    if (char === "$" || char === "`") return undefined
    if (quote === undefined && /[\s;|&<>()*?\[\]{}~]/.test(char)) return undefined
    result += char
  }
  return quote === undefined ? result : undefined
}

/** Home directory the spawned shell will use for `~` expansion. */
export function spawnHomeDirectory(env: NodeJS.Dict<string> = process.env): string {
  const home = env.HOME || env.USERPROFILE
  return home || os.homedir()
}

/** Expand only the current user's POSIX home shorthand. `~user` requires a
 * shell/user database lookup and is therefore treated as dynamic. */
export function expandLeadingTilde(value: string, home = os.homedir()): string | undefined {
  if (value === "~") return home
  if (value.startsWith("~/") || value.startsWith("~\\")) return home + value.slice(1)
  if (value.startsWith("~")) return undefined
  return value
}

// Matches any shell metacharacter that makes an argument non-literal: variable
// references ($f, ${f}), command/arithmetic substitution ($(...)), globs
// (* ? [ ]), and brace expansion ({a,b}). Such args must NOT be treated as
// static paths — the literal text (e.g. "$f" inside a `for f ...; do cat $f`
// loop) would resolve to a bogus path and the preflight would report a false
// "Path does not exist", blocking a valid command.
const SHELL_EXPANSION_OR_GLOB = /[$*?[\]{}]/

export function isStaticPathArg(value: string) {
  const stripped = stripShellQuotes(value)
  if (!stripped || hasDynamicShellExpansion(stripped)) return undefined
  // Skip anything the shell expands or globs, and leading ~ home expansion.
  if (SHELL_EXPANSION_OR_GLOB.test(stripped) || stripped.startsWith("~")) return undefined
  return stripped
}

function positionalArgs(args: string[]) {
  const result: string[] = []
  let afterSeparator = false
  for (const arg of args) {
    if (!afterSeparator && arg === "--") {
      afterSeparator = true
      continue
    }
    if (!afterSeparator && arg.startsWith("-")) continue
    result.push(arg)
  }
  return result
}

function hasAnyFlag(args: string[], flags: string[]) {
  for (const arg of args) {
    if (arg === "--") return false
    if (flags.includes(arg)) return true

    const shortFlagGroup = arg.startsWith("-") && !arg.startsWith("--")
    if (shortFlagGroup && flags.some((flag) => flag.length === 2 && arg.includes(flag[1]!))) return true
  }
  return false
}

export function staticallyCheckablePathArgs(cmd: string, args: string[]) {
  const positional = positionalArgs(args)
  switch (cmd) {
    case "cd":
      return positional.slice(0, 1)
    case "cat":
      return positional
    case "rm":
      if (hasAnyFlag(args, ["-f", "--force"])) return []
      return positional
    case "mv":
    case "cp":
      return positional.length > 1 ? positional.slice(0, -1) : positional
    default:
      return []
  }
}

/**
 * Literal paths a command is expected to create. The bash preflight uses
 * these only to avoid rejecting a later read in the same compound command;
 * isolation and write permissions are still enforced independently.
 */
export function staticallyCreatedPathArgs(cmd: string, args: string[]) {
  const positional = positionalArgs(args)
  switch (cmd) {
    case "mkdir":
    case "touch":
    case "tee":
      return positional
    case "mv":
    case "cp":
      return positional.length > 1 ? positional.slice(-1) : []
    default:
      return []
  }
}

export function hasDynamicRedirection(command: string) {
  // The redirect operator must be caught wherever it appears: `echo pwned>$F`
  // has no whitespace before the `>`, so requiring a delimiter would let the
  // expansion target through. Fd duplication (`2>&1`) never matches because
  // `&` does not start an expansion.
  return />>?\s*(?:\$|`)/.test(command)
}

export function absolutePathLiterals(value: string) {
  return Array.from(value.matchAll(/["'](\/[^"']+)["']/g), (match) => match[1]).filter(Boolean)
}

function truncateUtf8ByBytes(input: string, maxBytes: number): string {
  const bytes = Buffer.from(input, "utf8")
  if (bytes.byteLength <= maxBytes) return input

  const end = safeUtf8PrefixLength(bytes, maxBytes)
  return bytes.subarray(0, end).toString("utf8")
}

export function truncateBashMetadata(input: string, maxBytes: number): string {
  if (Buffer.byteLength(input, "utf8") <= maxBytes) return input
  return truncateUtf8ByBytes(input, maxBytes) + "\n\n..."
}

/**
 * Mirror of `truncateBashMetadata` that keeps the newest output. The live
 * progress snapshot uses this: while a command runs the transcript shows the
 * tail, and the head stops changing once the cap is crossed, so a tail is both
 * the useful window and never a byte-identical duplicate publish.
 */
export function tailBashMetadata(input: string, maxBytes: number): string {
  if (Buffer.byteLength(input, "utf8") <= maxBytes) return input
  return "...\n\n" + truncateUtf8FromEnd(input, maxBytes)
}

function truncateUtf8FromEnd(input: string, maxBytes: number): string {
  const bytes = Buffer.from(input, "utf8")
  if (bytes.byteLength <= maxBytes) return input
  const start = bytes.byteLength - safeUtf8SuffixLength(bytes, maxBytes)
  return bytes.subarray(start).toString("utf8")
}

/** Byte count of the longest UTF-8 suffix that fits in `maxBytes` without splitting a character. */
export function safeUtf8SuffixLength(chunk: Buffer, maxBytes: number): number {
  const bounded = Math.min(Math.max(0, maxBytes), chunk.length)
  let start = chunk.length - bounded
  // A continuation byte (0b10xxxxxx) has no leading byte in the window; skip the
  // whole character so the decoded suffix never starts mid-sequence.
  while (start < chunk.length && (chunk[start]! & 0xc0) === 0x80) start++
  return chunk.length - start
}

export function safeUtf8PrefixLength(chunk: Buffer, maxBytes: number): number {
  const bounded = Math.min(Math.max(0, maxBytes), chunk.length)
  let end = 0
  for (let index = 0; index < bounded; ) {
    const byte = chunk[index]!
    let width = 0
    if ((byte & 0x80) === 0) width = 1
    else if ((byte & 0xe0) === 0xc0) width = 2
    else if ((byte & 0xf0) === 0xe0) width = 3
    else if ((byte & 0xf8) === 0xf0) width = 4
    if (width === 0 || index + width > bounded) break
    end = index + width
    index = end
  }
  return end
}

export function refProcessIfAvailable(proc: { ref?: unknown }): boolean {
  if (typeof proc.ref !== "function") return false
  proc.ref()
  return true
}
