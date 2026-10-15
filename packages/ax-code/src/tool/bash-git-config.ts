import path from "path"
import { hasDynamicShellExpansion } from "./bash-helpers"

// git config keys that can execute code when set: hook injection, arbitrary
// command wrappers, external protocol handlers, filter processes, pagers.
// These are stable git keys, so an explicit guard list is appropriate — mirrors
// Isolation.NETWORK_COMMANDS. Matching is case-insensitive (git normalizes key
// case before lookup).
const DANGEROUS_GIT_CONFIG_KEYS = [
  "core.hookspath",
  "core.fsmonitor",
  "core.sshcommand",
  "core.editor",
  "core.pager",
  "alias.",
  "include.path",
  "includeif.",
  "credential.helper",
  "protocol.",
  "extensions.",
  "filter.",
  "pager.",
  "diff.external",
  "gpg.program",
  "sequence.editor",
] as const

// Subsections contain caller-chosen names (including dotted URLs), so match
// the executable field at the end instead of blocking every setting in a family.
const DANGEROUS_GIT_CONFIG_PATTERNS = [
  /^core\.(?:askpass|gitproxy|alternaterefscommand)$/,
  /^interactive\.difffilter$/,
  /^imap\.tunnel$/,
  /^instaweb\.httpd$/,
  /^gpg\.ssh\.defaultkeycommand$/,
  /^credential\..+\.helper$/s,
  /^diff\..+\.(?:command|textconv)$/s,
  /^merge\..+\.driver$/s,
  /^(?:difftool|mergetool|browser|man)\..+\.(?:cmd|path)$/s,
  /^guitool\..+\.cmd$/s,
  /^trailer\..+\.(?:cmd|command)$/s,
  /^gpg\..+\.program$/s,
  /^remote\..+\.(?:uploadpack|receivepack|vcs)$/s,
  /^sendemail(?:\..+)?\.(?:cccmd|tocmd|headercmd|sendmailcmd)$/s,
] as const

const GIT_SENDMAIL_SERVER_KEY = /^sendemail(?:\..+)?\.smtpserver$/s
const GIT_SUBMODULE_UPDATE_KEY = /^submodule\..+\.update$/s

export function isDangerousGitConfigKey(key: string, value?: string): boolean {
  if (
    DANGEROUS_GIT_CONFIG_KEYS.some((prefix) => key.startsWith(prefix)) ||
    DANGEROUS_GIT_CONFIG_PATTERNS.some((pattern) => pattern.test(key))
  )
    return true
  if (value === undefined) return false
  // These fields also accept ordinary hostnames or built-in update modes.
  if (GIT_SENDMAIL_SERVER_KEY.test(key)) {
    return (
      path.posix.isAbsolute(value) ||
      path.win32.isAbsolute(value) ||
      value.startsWith("~") ||
      hasDynamicShellExpansion(value)
    )
  }
  if (GIT_SUBMODULE_UPDATE_KEY.test(key)) return value.startsWith("!") || hasDynamicShellExpansion(value)
  return false
}

// Parse config options once so option values and tokens after -- never act
// as flags. Both legacy actions and the modern config subcommands are used.
// Flag tables hoisted out of the parse loop: membership must not allocate a new
// array per argument. bash-helpers and bash-network-heuristics keep their flag
// tables at module scope the same way.
const READ_ACTIONS = new Set(["--get", "--get-regexp", "--get-all", "--get-urlmatch", "--list", "-l"])
const CONFIG_SUBCOMMANDS = new Set(["get", "list", "set", "unset", "rename-section", "remove-section", "edit"])
const LOCATION_FLAGS = new Set(["--global", "--system", "--worktree"])
const WHOLE_FILE_FLAGS = new Set(["--rename-section", "--remove-section", "--edit", "-e"])
const VALUE_FLAGS = new Set(["--type", "-t", "--default", "--value", "--comment"])
const WRITE_ACTIONS = new Set([
  "--add",
  "--replace-all",
  "--unset",
  "--unset-all",
  "--rename-section",
  "--remove-section",
  "--edit",
  "-e",
])

export function gitConfigInvocation(args: string[]): {
  key?: string
  value?: string
  file?: string
  isRead: boolean
  wholeFile: boolean
  unresolvedLocation: boolean
} {
  let action = CONFIG_SUBCOMMANDS.has(args[0]) ? args[0] : undefined
  let wholeFile = action === "rename-section" || action === "remove-section" || action === "edit"
  let file: string | undefined
  let unresolvedLocation = false
  let options = true
  const positional: string[] = []
  for (let i = action ? 1 : 0; i < args.length; i++) {
    const arg = args[i]
    if (options && arg === "--") {
      options = false
      continue
    }
    if (options && arg.startsWith("-")) {
      if (arg === "--local") continue
      if (LOCATION_FLAGS.has(arg)) unresolvedLocation = true
      if (WHOLE_FILE_FLAGS.has(arg)) wholeFile = true
      if (arg === "--file" || arg === "-f") file = args[++i]
      else if (arg.startsWith("--file=")) file = arg.slice(7)
      else if (arg.startsWith("-f")) file = arg.slice(2)
      else if (VALUE_FLAGS.has(arg)) i++
      else if (READ_ACTIONS.has(arg)) action = "get"
      else if (WRITE_ACTIONS.has(arg)) action = "set"
      // Git accepts abbreviated long options. Unmodeled options cannot be
      // assumed unrelated to the destination (for example --glob or --fi).
      else unresolvedLocation = true
      continue
    }
    positional.push(arg)
  }
  return {
    key: positional[0]?.toLowerCase(),
    value: positional[1],
    file,
    wholeFile,
    unresolvedLocation,
    isRead: action === "get" || action === "list" || (!action && positional.length === 1),
  }
}

// git global flags that relocate where `git config` writes: `-C <dir>`
// chdirs before every other path is resolved (including relative --file
// targets and the implicit .git/config default), and `--git-dir <dir>` /
// `--git-dir=<dir>` replaces the .git directory so the implicit target
// becomes <dir>/config. Git requires the separate-argument form for -C and
// accepts both forms for --git-dir. Multiple -C values fold (each later one
// is interpreted relative to the previous, per git), so every -C value is
// collected in order and the caller resolves the chain; the last --git-dir
// wins. Pure command-text parsing — no path resolution happens here.
export function gitConfigLocationFlags(args: string[]): { cdChain: string[]; gitDir?: string } {
  const cdChain: string[] = []
  let gitDir: string | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined) continue
    if (arg === "-C") {
      const value = args[i + 1]
      if (value !== undefined) cdChain.push(value)
      i++
      continue
    }
    // git also accepts the directory glued to the flag: `git -C<dir> ...`.
    if (arg.startsWith("-C") && arg.length > 2) {
      cdChain.push(arg.slice(2))
      continue
    }
    if (arg === "-c" || arg === "--work-tree" || arg === "--namespace") {
      i++
      continue
    }
    if (arg === "--git-dir") {
      gitDir = args[i + 1]
      i++
      continue
    }
    if (arg.startsWith("--git-dir=")) gitDir = arg.slice("--git-dir=".length)
  }
  return { cdChain, gitDir }
}
