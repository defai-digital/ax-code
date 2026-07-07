import { isActiveTodo } from "./todo-status"
import { asRecordOrUndefined } from "../util/record"

/**
 * Evidence gate for `update_goal { status: "complete" }`.
 *
 * The goal continuation prompt tells the model not to declare a goal
 * complete until the objective is actually achieved, but that was
 * prompt-only — a model could end a goal run early by simply calling
 * update_goal. This gate adds the same kind of runtime enforcement the
 * todo completion gate provides:
 *
 *   1. A goal cannot complete while todos are still pending.
 *   2. If the session modified files SINCE THE GOAL WAS CREATED, at least
 *      one command (bash) must have completed AFTER the last file mutation
 *      — i.e. the model has to run its tests/build before claiming
 *      success. Goals that never modified files (research/review goals)
 *      are not affected, and edits from before the goal (earlier
 *      conversation, forked-session history) do not count.
 *
 * A bash run only counts as verification when it exited 0 and was not a
 * purely trivial command (`echo done`, `true`, `sleep` …) — otherwise the
 * gate could be satisfied without exercising the changes at all. Parts
 * recorded before exit codes were captured (no metadata.exit) are still
 * accepted so old sessions can complete.
 *
 * Both rejections are recoverable: the model finishes the todos or runs
 * a verification command, then calls update_goal again.
 */
export namespace GoalVerification {
  export type Todo = { status?: unknown }

  export type Message = {
    info?: { role?: string; time?: { created?: number } }
    parts?: readonly unknown[]
  }

  export type Decision =
    | { ok: true }
    | { ok: false; reason: "pending_todos"; message: string }
    | { ok: false; reason: "unverified_changes"; message: string }

  const MUTATION_TOOLS = new Set(["edit", "write", "apply_patch", "multiedit", "patch"])
  const VERIFICATION_TOOLS = new Set(["bash"])

  // Commands that observe or wait but cannot verify a change. A bash call
  // counts as verification only if at least one pipeline segment starts
  // with something outside this set. Read-only observation commands (ls,
  // cat, grep, git status, ...) are listed too: after editing files, a model
  // could otherwise satisfy the gate by merely LOOKING at its edits instead
  // of exercising them — verification means running a build/test/typecheck
  // or the changed program, not re-reading the diff.
  const TRIVIAL_COMMANDS: ReadonlySet<string> = new Set([
    "echo",
    "printf",
    "true",
    ":",
    "sleep",
    "pwd",
    "cd",
    "touch",
    "exit",
    // Read-only file/dir observation
    "ls",
    "cat",
    "head",
    "tail",
    "less",
    "more",
    "tree",
    "find",
    "fd",
    "stat",
    "file",
    "wc",
    "du",
    "df",
    "realpath",
    "readlink",
    "dirname",
    "basename",
    "which",
    "whereis",
    "type",
    // Text search / transforms that inspect rather than exercise a change
    "grep",
    "egrep",
    "fgrep",
    "rg",
    "ag",
    "sed",
    "awk",
    "cut",
    "sort",
    "uniq",
    "tr",
    "diff",
    "cmp",
    "jq",
    "yq",
    // Environment/system observation
    "env",
    "printenv",
    "whoami",
    "hostname",
    "uname",
    "date",
    "ps",
    // Version-control observation: git status/diff/log inspect state; they
    // do not run the changed code. (This also excludes git commit/push from
    // counting as verification — committing is not testing.)
    "git",
  ])

  function firstWord(segment: string) {
    const tokens = segment.trim().split(/\s+/)
    for (const token of tokens) {
      // Strip leading subshell/group punctuation so `(sleep 5)` is judged by
      // `sleep`, not `(sleep` — otherwise a trivial command wrapped in a
      // subshell escapes the trivial check and wrongly counts as verification.
      const cleaned = token.replace(/^[({]+/, "")
      if (cleaned === "") continue
      // Skip leading VAR=value assignments so `CI=1 bun test` is judged by
      // the actual command.
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cleaned)) continue
      return cleaned
    }
    return ""
  }

  function isTrivialCommand(command: string) {
    const segments = command.split(/&&|\|\||;|\||\n/)
    for (const segment of segments) {
      const word = firstWord(segment)
      if (!word) continue
      if (!TRIVIAL_COMMANDS.has(word)) return false
    }
    return true
  }

  function isVerificationRun(state: Record<string, unknown> | undefined) {
    const metadata = asRecordOrUndefined(state?.["metadata"])
    const exit = metadata?.["exit"]
    // A failed command proves nothing — the change is not verified.
    if (typeof exit === "number" && exit !== 0) return false
    const params = asRecordOrUndefined(state?.["input"])
    const command = params?.["command"]
    if (typeof command === "string" && isTrivialCommand(command)) return false
    return true
  }

  export function decide(input: {
    messages: readonly Message[]
    pendingTodos: readonly Todo[]
    // Only messages created at/after this timestamp count toward the
    // mutation/verification scan — pass the goal's creation time so edits
    // from BEFORE the goal (earlier conversation, or history inherited by a
    // forked session) cannot block a goal that never touched a file.
    // Messages without a timestamp are still scanned (conservative).
    since?: number
  }): Decision {
    const pending = input.pendingTodos.filter(isActiveTodo)
    if (pending.length > 0) {
      return {
        ok: false,
        reason: "pending_todos",
        message:
          `Cannot mark the goal complete: ${pending.length} todo(s) are still pending or in progress. ` +
          `Finish or cancel them first, then mark the goal complete.`,
      }
    }

    let sawMutation = false
    let verifiedAfterMutation = true
    for (const message of input.messages) {
      if (message.info?.role !== "assistant") continue
      const created = message.info?.time?.created
      if (input.since !== undefined && typeof created === "number" && created < input.since) continue
      for (const part of message.parts ?? []) {
        const record = asRecordOrUndefined(part)
        if (!record || record["type"] !== "tool") continue
        const tool = record["tool"]
        if (typeof tool !== "string") continue
        const state = asRecordOrUndefined(record["state"])
        if (state?.["status"] !== "completed") continue
        if (MUTATION_TOOLS.has(tool)) {
          sawMutation = true
          verifiedAfterMutation = false
        } else if (VERIFICATION_TOOLS.has(tool) && isVerificationRun(state)) {
          verifiedAfterMutation = true
        }
      }
    }
    if (sawMutation && !verifiedAfterMutation) {
      return {
        ok: false,
        reason: "unverified_changes",
        message:
          `Cannot mark the goal complete: files were modified after the last command run. ` +
          `Run your tests, build, or another verification command to confirm the changes work, ` +
          `then mark the goal complete.`,
      }
    }

    return { ok: true }
  }
}
