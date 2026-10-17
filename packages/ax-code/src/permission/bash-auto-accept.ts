import path from "node:path"
import { classifyReadOnlyCommand } from "../tool/bash-readonly"
import { findWrappedCommand } from "../tool/bash-destructive"

export const MAX_AUTO_ACCEPT_COMMAND = 4096

// A deliberately tiny allowlist. git is absent: diff, log and show can run textconv or external diff
// programs named by repository config, and branch/add update refs that fire reference hooks. uniq, sort,
// cut and the other filters are absent because some take an output file as a positional argument.
// rg is absent: it recurses into directory operands (reading files the target check never sees) and it
// honours RIPGREP_CONFIG_PATH, which can add --pre=<program>. Recursive options (-r/-R) and --hidden are
// absent from READ_OPTIONS for the same reason: only the operands the user can see are checked.
const AUTO_ACCEPT_COMMANDS = new Set(["ls", "cat", "head", "tail", "wc", "grep", "pwd", "echo"])
// Only options with understood, non-executable semantics. Unknown options keep the prompt,
// including glued output paths, config overrides and pathspec files.
const READ_OPTIONS = new Set([
  "-a",
  "-l",
  "-la",
  "-al",
  "-h",
  "-lah",
  "-lh",
  "-n",
  "-c",
  "-w",
  "-i",
  "-v",
  "-F",
  "-E",
  "--line-number",
  "--count",
])

/** A deliberately small literal-shell grammar. Unmodelled syntax keeps the ordinary prompt. */
export function bashAutoAcceptTargets(metadata?: Record<string, unknown>): string[] | undefined {
  const raw = metadata?.bashCommand
  const cwd = metadata?.bashCwd
  if (typeof raw !== "string" || !raw || raw.length > MAX_AUTO_ACCEPT_COMMAND) return undefined
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return undefined
  if (/[\\$`{}()[\]*?~\n\r\0]/.test(raw)) return undefined
  const tokens: string[] = []
  const lexer = /\s+|"[^"\n]*"|'[^'\n]*'|&&|\|\||>>|[;|<>]|[^\s"';&|<>]+/gy
  let offset = 0
  let previousWordEnd = -1
  while (offset < raw.length) {
    lexer.lastIndex = offset
    const match = lexer.exec(raw)
    if (!match) return undefined
    offset = lexer.lastIndex
    if (!/^\s+$/.test(match[0])) {
      const word = !/^[;&|<>]/.test(match[0])
      if (word && previousWordEnd === match.index) return undefined
      previousWordEnd = word ? offset : -1
      tokens.push(match[0])
    }
  }
  const targets = [cwd]
  let argv: string[] = []
  const literal = (value: string) => value.replace(/^(["'])(.*)\1$/s, "$2")
  const addPath = (value: string) => {
    if (!value || value.includes(":") || value.includes("=") || value.startsWith("-")) return false
    // `link/../x` is normalised before any symlink in the path is inspected, so the checked path and the
    // path the OS opens can differ. Any parent reference keeps the prompt.
    if (value.split(/[\\/]/).includes("..")) return false
    targets.push(path.resolve(cwd, value))
    return true
  }
  const segment = () => {
    const [name, ...args] = argv
    argv = []
    if (!name || name.includes("/") || name.includes("=")) return false
    if (findWrappedCommand([name, ...args])?.name !== name) return false
    if (!AUTO_ACCEPT_COMMANDS.has(name)) return false
    if (classifyReadOnlyCommand([name, ...args]) !== undefined) return false
    const options = READ_OPTIONS
    let operands = false
    for (const arg of args) {
      if (!operands && arg === "--") {
        operands = true
        continue
      }
      if (!operands && arg.startsWith("-")) {
        if (!options.has(arg)) return false
      } else if (!addPath(arg)) return false
    }
    return true
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if ([";", "&&", "||", "|"].includes(token)) {
      if (!segment()) return undefined
    } else if ([">", ">>", "<"].includes(token)) {
      if (token !== "<") return undefined
      const target = tokens[++i]
      if (!target || /^[;|<>]/.test(target) || !addPath(literal(target))) return undefined
    } else {
      // Adjacent quote fragments are valid shell but outside this literal grammar.
      // They must not turn a different executable into an allowlisted one.
      argv.push(literal(token))
    }
  }
  if (!segment()) return undefined
  return targets
}
