import { evaluate } from "@/permission/evaluate"
import { Wildcard } from "@/util/wildcard"
import {
  classifyDestructiveCommand,
  findWrappedCommand,
  gitSubcommand,
  timeWrapperWritesFile,
} from "./bash-destructive"
import { stripShellQuotes } from "./bash-helpers"

/**
 * ADR-208: fail-closed read-only classification for the plan agent's bash.
 *
 * The plan agent denies edit tools, but its bash permission is allow, so the
 * "read-only in plan mode" rule previously existed only in prompt prose.
 * This classifier accepts only known read commands, reuses the existing bash
 * parsing (bash-destructive.ts wrapper resolution and git subcommand
 * detection; command splitting stays in bash-impl.ts's tree-sitter scan), and
 * denies everything it cannot statically classify. The allowlist is a
 * constant that can be extended in one place.
 *
 * Anything not listed here is denied — including `cd`, `test`, `sed` without
 * -i, and every build/test/install command. The denial message tells the
 * model to hand the command to the build agent instead.
 *
 * Known limitation closed by ADR-224: a user permission rule that explicitly
 * allows bash for the plan agent was originally undetectable from the tool
 * layer. bash-impl.ts now feeds the user-configured ruleset (never the
 * built-in agent defaults) into explicitBashAllowOverride below, which can
 * skip the classifier denial for a single matching command.
 */

/** Read-only commands the plan agent may run as-is (after wrapper resolution). */
const READ_COMMANDS: ReadonlySet<string> = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "pwd",
  "which",
  "stat",
  "file",
  "tree",
  "sort",
  "uniq",
  "cut",
  "echo",
])

/** git subcommands that never write, regardless of flags. */
const GIT_READ_SUBCOMMANDS: ReadonlySet<string> = new Set(["status", "log", "diff", "show", "rev-parse", "ls-files"])

/**
 * git global switches that inject configuration or an executable path.
 * `-c`, `--config-env=...` and environment variables such as
 * `GIT_EXTERNAL_DIFF` / `GIT_CONFIG_*` let git run an arbitrary helper
 * (`diff.external`, `core.fsmonitor`, ...) from an otherwise read-only
 * subcommand, so the plan classifier must refuse them.
 */
const GIT_EXECUTION_GLOBAL = new Set(["-c", "--config-env", "--exec-path"])
const GIT_EXECUTION_GLOBAL_PREFIXES = ["--config-env=", "--exec-path="]
/** Read-only subcommand flags that ask git to run a configured external helper. */
const GIT_EXECUTION_READ_FLAGS = new Set(["--ext-diff", "--textconv", "--paginate"])
const GIT_EXECUTION_ENV = /^(?:GIT_CONFIG_[A-Z0-9_]*|GIT_EXTERNAL_DIFF)$/i

function gitEnvironmentOverride(parts: readonly string[]): string | undefined {
  for (const part of parts) {
    const separator = part.indexOf("=")
    if (separator <= 0) continue
    const name = part.slice(0, separator)
    if (GIT_EXECUTION_ENV.test(name)) return name
  }
  return undefined
}

/** `find` flags that hand matched paths to a command or write a listing file. */
const FIND_MUTATING_FLAG = /^-(?:exec|execdir|ok|okdir|delete|fls|fprint0?|fprintf)$/

/** `sort -o`/`-T` write files; `--compress-program` executes a program. */
const SORT_WRITING_FLAG = /^-[^-]*[oT]/
const UNIQ_VALUE_OPTIONS = new Set(["-f", "--skip-fields", "-s", "--skip-chars", "-w", "--check-chars"])

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

function sortWrites(args: readonly string[]): boolean {
  return args.some(
    (arg) =>
      SORT_WRITING_FLAG.test(arg) ||
      arg === "--output" ||
      arg.startsWith("--output=") ||
      arg === "--temporary-directory" ||
      arg.startsWith("--temporary-directory=") ||
      arg === "--compress-program" ||
      arg.startsWith("--compress-program="),
  )
}

/** A second positional operand makes `uniq` write its output to that file. */
function uniqWrites(args: readonly string[]): boolean {
  let operands = 0
  let optionsEnded = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (!optionsEnded && arg === "--") {
      optionsEnded = true
      continue
    }
    if (!optionsEnded && arg !== "-" && arg.startsWith("-")) {
      if (UNIQ_VALUE_OPTIONS.has(arg)) index++
      continue
    }
    operands++
  }
  return operands > 1
}

function treeWrites(args: readonly string[]): boolean {
  return args.some((arg) => /^-[^-]*o/.test(arg) || arg === "--output" || arg.startsWith("--output="))
}

function rgExecutes(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--pre" || arg.startsWith("--pre=") || arg.startsWith("--pre-glob"))
}

const DISCARD_TARGET = "/dev/null"

/**
 * Classifies one parsed command argv (command name first, quotes as produced
 * by bash-impl.ts's tree-sitter scan). Returns undefined when the command is
 * read-only, or a human-readable reason when the plan agent must not run it.
 * Fails closed: an unrecognized command is always denied.
 */
export function classifyReadOnlyCommand(parts: readonly string[]): string | undefined {
  // Destructive commands are denied with their existing classification so the
  // plan-agent denial explains the danger, not just the policy.
  const destructive = classifyDestructiveCommand([...parts])
  if (destructive) return destructive

  let assignmentIndex = 0
  while (assignmentIndex < parts.length && ENV_ASSIGNMENT.test(parts[assignmentIndex] ?? "")) assignmentIndex++
  const command = parts.slice(assignmentIndex)
  // GNU time -o/--output creates or truncates its output file. Wrapper
  // resolution discards wrapper flags, so `command time -o /tmp/x ls` would
  // otherwise resolve to `ls` and be allowlisted.
  if (timeWrapperWritesFile(command)) return "time -o/--output writes its timing report to a file"
  const resolved = findWrappedCommand(command)
  if (!resolved) return "the command could not be classified"
  const { name, args } = resolved

  if (name === "git") {
    const environment = gitEnvironmentOverride(parts)
    if (environment) return `git with ${environment} can run an external command`
    const sub = gitSubcommand(args)
    if (!sub) return "git without a subcommand"
    const globalArgs = args.slice(0, args.length - sub.rest.length - 1)
    const override = globalArgs.find(
      (arg) => GIT_EXECUTION_GLOBAL.has(arg) || GIT_EXECUTION_GLOBAL_PREFIXES.some((prefix) => arg.startsWith(prefix)),
    )
    if (override) return `git ${override} can run an external command`
    if (GIT_READ_SUBCOMMANDS.has(sub.subcommand)) {
      const helper = sub.rest.find((arg) => GIT_EXECUTION_READ_FLAGS.has(arg))
      if (helper) return `git ${sub.subcommand} ${helper} runs a configured external helper`
      // `git log/show/diff --output=<file>` writes the diff to that file.
      if (sub.rest.some((arg) => arg === "--output" || arg.startsWith("--output="))) {
        return `git ${sub.subcommand} --output writes to a file`
      }
      return undefined
    }
    if (sub.subcommand === "branch") {
      // `git branch` and `git branch --list` only list; any operand or
      // non-list flag may create, delete, or rename a branch.
      const listOnly = sub.rest.every((arg) => arg === "--list" || arg === "-l")
      return listOnly ? undefined : "git branch only lists with --list or no arguments"
    }
    return `git ${sub.subcommand} is not a read-only git command`
  }

  if (name === "find") {
    if (args.some((arg) => FIND_MUTATING_FLAG.test(arg))) {
      return "find with -exec/-ok/-delete/-fprint runs commands or writes files"
    }
    return undefined
  }

  // These allowlisted readers can still write or execute through their arguments.
  if (name === "sort" && sortWrites(args)) return "sort with an output or temporary directory writes to disk"
  if (name === "uniq" && uniqWrites(args)) return "uniq with a second operand writes its output to a file"
  if (name === "tree" && treeWrites(args)) return "tree -o writes its output to a file"
  if (name === "rg" && rgExecutes(args)) return "rg --pre runs an external program"
  if (name === "file" && args.some((arg) => arg === "--compile" || /^-[^-]*C/.test(arg))) {
    return "file -C compiles a magic database"
  }

  if (READ_COMMANDS.has(name)) return undefined

  // Friendlier reasons for the write commands local models reach for during
  // planning (ADR-208 context: sed -i, cat > file, tee, git commit).
  if (name === "sed" && args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || arg.startsWith("--in-place"))) {
    return "sed -i edits files in place"
  }
  if (name === "tee") return "tee writes its input to files"
  if (name === "dd" && args.some((arg) => /^of=/.test(arg))) return "dd of= writes raw data to a file or device"
  if (name === "curl" && args.some((arg) => arg === "-o" || arg.startsWith("--output"))) {
    return "curl -o writes the response to a file"
  }
  if (name === "wget" && args.some((arg) => arg === "-O" || arg.startsWith("--output-document"))) {
    return "wget -O writes the response to a file"
  }

  return `"${name}" is not in the plan agent's read-only command allowlist`
}

/**
 * Write-redirect policy for the plan agent. `target` is the decoded literal
 * redirect target, or undefined when it was dynamic or undecodable. Only
 * discarding to /dev/null is allowed; every other write redirection creates
 * or truncates a file and is denied.
 */
export function readonlyRedirectDenial(target: string | undefined): string | undefined {
  if (target === undefined) return "output redirection to a non-literal target"
  const literal = stripShellQuotes(target)
  if (literal === DISCARD_TARGET) return undefined
  return `output redirection to "${literal}" writes a file`
}

/** Builds the denial the plan agent's bash tool throws (ADR-208 wording). */
export function planReadOnlyError(denials: readonly string[]): string {
  const first = denials[0] ?? "the command is not read-only"
  const extra = denials.length > 1 ? ` (and ${denials.length - 1} more violation${denials.length > 2 ? "s" : ""})` : ""
  return `The plan agent's bash is read-only: ${first}${extra}. Hand this command to the build agent.`
}

/**
 * ADR-224: does an explicitly USER-configured bash allow rule match this
 * command, overriding the plan-agent classifier for this command only?
 *
 * `rules` comes from the user/project/managed config (`Config.get().permission`
 * through Permission.fromConfig) — never the built-in agent defaults. The
 * decision reuses evaluate()'s last-match-wins semantics, so a managed deny
 * (managed config merges last, highest priority) still beats a user allow.
 *
 * A rule counts only when the last matching rule is an allow whose pattern
 * names the command or a prefix of it: the pattern's first token must match
 * the command name and must not be composed purely of wildcard characters.
 * A bare `*` allow therefore never unlocks the classifier.
 *
 * Returns the matching pattern (for logging; arguments are never included)
 * or undefined when the classifier denial must stand.
 */
export function explicitBashAllowOverride(
  commandText: string,
  rules: readonly { permission: string; pattern: string; action: "allow" | "deny" | "ask" }[],
): string | undefined {
  const commandName = stripShellQuotes(commandText.split(/\s+/, 1)[0] ?? "")
  if (!commandName) return undefined
  const rule = evaluate("bash", commandText, [...rules])
  if (rule.action !== "allow") return undefined
  const head = rule.pattern.split(/\s+/, 1)[0] ?? ""
  // The pattern must name the command or a prefix: a first token made purely
  // of wildcards (`*`, `* *`) names no command and does not count.
  if (!head.replaceAll(/[*?]/g, "")) return undefined
  if (!Wildcard.match(commandName, head)) return undefined
  return rule.pattern
}
