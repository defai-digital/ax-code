import { classifyDestructiveCommand, findWrappedCommand, gitSubcommand } from "./bash-destructive"
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
 * Known limitation (documented in bash-impl.ts at the enforcement site): a
 * user permission rule that explicitly allows bash for the plan agent cannot
 * be detected from the tool layer, because the resolved permission policy is
 * only accessible through ctx.ask. Until that surfaces, the classifier
 * applies unconditionally for the plan agent.
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

/** `find` flags that hand matched paths to a command or write a listing file. */
const FIND_MUTATING_FLAG = /^-(?:exec|execdir|ok|okdir|delete|fls|fprint0?|fprintf)$/

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

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
  const resolved = findWrappedCommand(parts.slice(assignmentIndex))
  if (!resolved) return "the command could not be classified"
  const { name, args } = resolved

  if (name === "git") {
    const sub = gitSubcommand(args)
    if (!sub) return "git without a subcommand"
    if (GIT_READ_SUBCOMMANDS.has(sub.subcommand)) return undefined
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
