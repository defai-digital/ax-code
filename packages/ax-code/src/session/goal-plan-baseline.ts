import { git } from "../util/git"
import type { GoalAssurance } from "./goal-assurance"

const SNAPSHOT_TIMEOUT_MS = 2_000
const MAX_PATHS = 30
export const BASELINE_PLACEHOLDER = "{BASELINE}"

const UNAMBIGUOUS_REF = /@\{\s*u(?:pstream)?\s*\}|refs\/remotes\/[\w./-]+/gi
const GIT_REMOTE = /(?:origin|upstream)\/[\w./-]+/gi
const RANGE = /([^\s.;|&]+)\.\.\.?([^\s.;|&]+)/g
const MERGE_BASE = /merge-base(?:\s+--[^\s]+)*\s+([^\s]+)\s+([^\s]+)/gi
const ALLOWED_REV = /^(?:HEAD(?:[~^][^\s.]*)?|\{BASELINE\}|[0-9a-f]{7,40})$/i

export namespace GoalPlanBaseline {
  export type Snapshot = {
    head?: string
    branch?: string
    tracking?: string
    ahead?: number
    behind?: number
    divergedFromTracking: string[]
    dirty: string[]
  }

  export function writerUserText(objective: string, context?: string) {
    return context ? `OBJECTIVE:\n${objective}\n\n${context}` : `OBJECTIVE:\n${objective}`
  }

  export async function snapshot(cwd: string): Promise<Snapshot> {
    const run = async (args: string[]) => {
      const result = await git(args, { cwd, timeout: SNAPSHOT_TIMEOUT_MS })
      return result.exitCode === 0 ? result.text().trim() : undefined
    }
    const head = await run(["rev-parse", "HEAD"])
    if (!head) {
      return { divergedFromTracking: [], dirty: [] }
    }
    const [branch, tracking, porcelain] = await Promise.all([
      run(["rev-parse", "--abbrev-ref", "HEAD"]),
      run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
      run(["status", "--porcelain"]),
    ])
    const dirty = porcelain ? parsePorcelain(porcelain) : []
    if (!tracking) {
      return { head, branch, divergedFromTracking: [], dirty }
    }
    const counts = await run(["rev-list", "--left-right", "--count", `${tracking}...HEAD`])
    const [behind, ahead] = parseAheadBehind(counts)
    const mergeBase = await run(["merge-base", "HEAD", tracking])
    const diverged = mergeBase ? await run(["diff", "--name-only", `${mergeBase}..HEAD`]) : undefined
    return {
      head,
      branch,
      tracking,
      ahead,
      behind,
      divergedFromTracking: splitNames(diverged),
      dirty,
    }
  }

  export function promptContext(snap: Snapshot): string | undefined {
    if (!snap.head) return undefined
    const lines = ["WORKSPACE GIT (plan-time snapshot; this is CONTEXT, not extra scope):", `HEAD: ${snap.head}`]
    if (snap.branch) lines.push(`Branch: ${snap.branch}`)
    if (snap.tracking) {
      const ahead = snap.ahead ?? 0
      const behind = snap.behind ?? 0
      lines.push(`Tracking: ${snap.tracking} (ahead ${ahead}, behind ${behind})`)
      lines.push(...listBlock("Already diverged from tracking", snap.divergedFromTracking))
    }
    lines.push(...listBlock("Working tree dirty", snap.dirty))
    lines.push(
      `Use ${BASELINE_PLACEHOLDER} as the before-state of any "what this goal changed" git range.`,
      "Do not use origin/*, @{u}, or refs/remotes/* as that before-state unless OBJECTIVE names that remote.",
      "A gating check that is already failing for pre-existing divergence or dirty paths is invalid unless OBJECTIVE is to fix that failure; record those paths under Risks.",
    )
    return lines.join("\n")
  }

  export function prepareAssurance(
    assurance: GoalAssurance.Contract,
    input: { objective: string; snapshot?: Snapshot },
  ): GoalAssurance.Contract {
    const checks = assurance.checks.map((check) => {
      const command = rewriteBaseline(check.command, input.snapshot)
      assertNoPlaceholder(command, check.id, input.snapshot)
      assertGoalScopedGitRanges(command, check.id, input.objective)
      return command === check.command ? check : { ...check, command }
    })
    return { ...assurance, checks }
  }

  export function assertGoalScopedGitRanges(command: string, checkId: string, objective: string) {
    const unambiguous = uniqueMatches(command, UNAMBIGUOUS_REF)
    if (unambiguous.length > 0 && !objectiveAllowsRemote(objective, unambiguous)) {
      throw remoteBeforeStateError(checkId, unambiguous)
    }
    if (!looksLikeGitCommand(command)) return
    const text = gitRevisionText(command)
    const remotes = uniqueMatches(text, GIT_REMOTE)
    if (remotes.length > 0 && !objectiveAllowsRemote(objective, remotes)) {
      throw remoteBeforeStateError(checkId, remotes)
    }
    const before = [...rangeBeforeStates(text), ...mergeBaseRevs(text)].filter((rev) => !ALLOWED_REV.test(rev))
    if (before.length === 0) return
    if (objectiveAllowsRemote(objective, before)) return
    throw remoteBeforeStateError(checkId, before)
  }
}

const GIT_TOKENS = new Set(["git", "merge-base", "$GIT", "${GIT}"])
const NESTED_SHELL = new Set(["sh", "bash", "zsh", "ksh", "dash"])
const COMMAND_PREFIXES = new Set([
  "!",
  "if",
  "then",
  "else",
  "elif",
  "while",
  "until",
  "do",
  "time",
  "exec",
  "command",
  "builtin",
])
const MAX_NEST = 4

function looksLikeGitCommand(command: string, depth = 0): boolean {
  if (depth > MAX_NEST) return false
  return shellSegments(command).some((segment) => segmentLooksLikeGit(segment, depth))
}

function segmentLooksLikeGit(segment: string, depth: number): boolean {
  if (commandSubstitutions(segment).some((inner) => looksLikeGitCommand(inner, depth + 1))) return true
  const cmd = commandWord(segment)
  if (!cmd) return false
  if (GIT_TOKENS.has(cmd.value)) return true
  if (cmd.value === "eval") return looksLikeGitCommand(joinWords(cmd.rest), depth + 1)
  if (!NESTED_SHELL.has(cmd.value)) return false
  const script = dashCScript(cmd.rest)
  return script !== undefined && looksLikeGitCommand(script, depth + 1)
}

function gitRevisionText(command: string, depth = 0): string {
  if (depth > MAX_NEST) return ""
  return shellSegments(command)
    .flatMap((segment) => revisionTextsForSegment(segment, depth))
    .join(" ")
}

function revisionTextsForSegment(segment: string, depth: number): string[] {
  const out = commandSubstitutions(segment).map((inner) => gitRevisionText(inner, depth + 1))
  const cmd = commandWord(segment)
  if (!cmd) return out
  if (GIT_TOKENS.has(cmd.value)) {
    out.push(stripGitPathspec(segment))
    return out
  }
  if (cmd.value === "eval") {
    out.push(gitRevisionText(joinWords(cmd.rest), depth + 1))
    return out
  }
  if (NESTED_SHELL.has(cmd.value)) {
    const script = dashCScript(cmd.rest)
    if (script !== undefined) out.push(gitRevisionText(script, depth + 1))
  }
  return out
}

function stripGitPathspec(segment: string) {
  const cmd = commandWord(segment)
  if (!cmd || !GIT_TOKENS.has(cmd.value)) return segment
  const cut = segment.search(/\s--\s/)
  return cut === -1 ? segment : segment.slice(0, cut)
}

function commandWord(segment: string) {
  const words = shellWords(segment)
  let index = 0
  while (index < words.length && (isAssignmentWord(words[index]!) || COMMAND_PREFIXES.has(words[index]!.value))) {
    index++
  }
  const current = words[index]
  if (!current) return undefined
  return { value: current.value, rest: words.slice(index + 1) }
}

const SHELL_VALUE_OPTIONS = new Set(["--rcfile", "--init-file"])
const SHELL_OPTIONAL_VALUE_FLAGS = new Set(["-o", "-O", "-W"])

function dashCScript(args: ShellWord[]) {
  for (let index = 0; index < args.length; index++) {
    const value = args[index]!.value
    if (value === "--") return undefined
    if (value === "-c" || /^-[^-]*c$/.test(value)) {
      let next = index + 1
      if (args[next]?.value === "--") next++
      return args[next]?.value
    }
    if (value.startsWith("--rcfile=") || value.startsWith("--init-file=")) continue
    if (SHELL_VALUE_OPTIONS.has(value)) {
      if (index + 1 < args.length) index++
      continue
    }
    if (SHELL_OPTIONAL_VALUE_FLAGS.has(value)) {
      const next = args[index + 1]?.value
      if (next !== undefined && !next.startsWith("-")) index++
      continue
    }
    if (value.startsWith("-")) continue
    return undefined
  }
  return undefined
}

function joinWords(words: ShellWord[]) {
  return words.map((word) => word.value).join(" ")
}

function isAssignmentWord(word: ShellWord) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word.value)
}

type ShellWord = { value: string }

function shellSegments(command: string) {
  const segments: string[] = []
  let start = 0
  let quote: "none" | "single" | "double" = "none"
  for (let index = 0; index < command.length; ) {
    const char = command[index]!
    if (quote === "single") {
      if (char === "'") quote = "none"
      index++
      continue
    }
    if (quote === "double") {
      if (char === "\\" && index + 1 < command.length) {
        index += 2
        continue
      }
      if (char === '"') quote = "none"
      index++
      continue
    }
    if (char === "'") {
      quote = "single"
      index++
      continue
    }
    if (char === '"') {
      quote = "double"
      index++
      continue
    }
    if (char === "\\" && index + 1 < command.length) {
      index += 2
      continue
    }
    if (command.startsWith("&&", index) || command.startsWith("||", index)) {
      segments.push(command.slice(start, index))
      index += 2
      start = index
      continue
    }
    if (char === ";" || char === "|" || char === "&") {
      segments.push(command.slice(start, index))
      index++
      start = index
      continue
    }
    index++
  }
  segments.push(command.slice(start))
  return segments
}

function shellWords(input: string) {
  const words: ShellWord[] = []
  let index = 0
  while (index < input.length) {
    while (index < input.length && /\s/.test(input[index]!)) index++
    if (index >= input.length) break
    let value = ""
    let seen = false
    while (index < input.length && !/\s/.test(input[index]!)) {
      const char = input[index]!
      if (char === "'") {
        index++
        while (index < input.length && input[index] !== "'") value += input[index++]
        if (index < input.length) index++
        seen = true
        continue
      }
      if (char === '"') {
        index++
        while (index < input.length && input[index] !== '"') {
          if (input[index] === "\\" && index + 1 < input.length) {
            value += input[index + 1]
            index += 2
            continue
          }
          value += input[index++]
        }
        if (index < input.length) index++
        seen = true
        continue
      }
      if (char === "\\" && index + 1 < input.length) {
        value += input[index + 1]
        index += 2
        seen = true
        continue
      }
      value += char
      index++
      seen = true
    }
    if (seen) words.push({ value })
  }
  return words
}

function commandSubstitutions(input: string) {
  const found: string[] = []
  let quote: "none" | "single" | "double" = "none"
  let justClosedSubstitution = false
  for (let index = 0; index < input.length; ) {
    const char = input[index]!
    if (quote === "single") {
      if (char === "'") quote = "none"
      index++
      continue
    }
    if (quote === "double") {
      if (char === "\\" && index + 1 < input.length) {
        index += 2
        continue
      }
      if (char === '"') {
        quote = "none"
        index++
        continue
      }
      if (char === "$" && input[index + 1] === "(") {
        const [inner, next] = readBalancedParen(input, index + 2)
        found.push(inner)
        index = next
        continue
      }
      if (char === "`") {
        const [inner, next] = readBacktick(input, index + 1)
        found.push(inner)
        index = next
        continue
      }
      index++
      continue
    }
    if (char === "'") {
      quote = "single"
      index++
      continue
    }
    if (char === '"') {
      quote = "double"
      index++
      continue
    }
    if (char === "\\" && index + 1 < input.length) {
      index += 2
      continue
    }
    if (char === "#") {
      const glued = justClosedSubstitution
      justClosedSubstitution = false
      const previous = index === 0 ? "" : input[index - 1]!
      const grouping = previous === ")" && !isEscapedAt(input, index - 1)
      if (!glued && (index === 0 || /[\s;&|]/.test(previous) || grouping)) {
        while (index < input.length && input[index] !== "\n") index++
        continue
      }
    }
    if (char === "$" && input[index + 1] === "(") {
      const [inner, next] = readBalancedParen(input, index + 2)
      found.push(inner)
      index = next
      justClosedSubstitution = true
      continue
    }
    if (char === "`") {
      const [inner, next] = readBacktick(input, index + 1)
      found.push(inner)
      index = next
      justClosedSubstitution = true
      continue
    }
    justClosedSubstitution = false
    index++
  }
  return found
}

function isEscapedAt(input: string, index: number) {
  let slashes = 0
  for (let cursor = index - 1; cursor >= 0 && input[cursor] === "\\"; cursor--) slashes++
  return slashes % 2 === 1
}

function readBacktick(input: string, start: number): [string, number] {
  let inner = ""
  let index = start
  while (index < input.length && input[index] !== "`") {
    if (input[index] === "\\" && index + 1 < input.length) {
      inner += input[index + 1]
      index += 2
      continue
    }
    inner += input[index++]
  }
  if (index < input.length) index++
  return [inner, index]
}

function readBalancedParen(input: string, start: number): [string, number] {
  let depth = 1
  let quote: "none" | "single" | "double" = "none"
  for (let index = start; index < input.length; ) {
    const char = input[index]!
    if (quote === "single") {
      if (char === "'") quote = "none"
      index++
      continue
    }
    if (quote === "double") {
      if (char === "\\" && index + 1 < input.length) {
        index += 2
        continue
      }
      if (char === '"') quote = "none"
      index++
      continue
    }
    if (char === "'") {
      quote = "single"
      index++
      continue
    }
    if (char === '"') {
      quote = "double"
      index++
      continue
    }
    if (char === "\\" && index + 1 < input.length) {
      index += 2
      continue
    }
    if (char === "(") depth++
    else if (char === ")") {
      depth--
      if (depth === 0) return [input.slice(start, index), index + 1]
    }
    index++
  }
  return [input.slice(start), input.length]
}

function remoteBeforeStateError(checkId: string, refs: string[]) {
  return new Error(
    `Assurance check "${checkId}" uses remote-tracking ref ${refs.map((ref) => `"${ref}"`).join(", ")} as a git before-state. ` +
      `Unless the objective names that remote, use ${BASELINE_PLACEHOLDER} (the plan-time HEAD SHA) so pre-existing divergence cannot make the goal uncompletable. Resubmit.`,
  )
}

function rewriteBaseline(command: string, snapshot: GoalPlanBaseline.Snapshot | undefined) {
  if (!command.includes(BASELINE_PLACEHOLDER)) return command
  if (!snapshot?.head) {
    throw new Error(
      `${BASELINE_PLACEHOLDER} requires a git HEAD at plan time; this workspace has no usable HEAD. Name an explicit revision or drop the placeholder.`,
    )
  }
  return command.split(BASELINE_PLACEHOLDER).join(snapshot.head)
}

function assertNoPlaceholder(command: string, checkId: string, snapshot: GoalPlanBaseline.Snapshot | undefined) {
  if (!command.includes(BASELINE_PLACEHOLDER)) return
  throw new Error(
    `Assurance check "${checkId}" still contains ${BASELINE_PLACEHOLDER}` +
      (snapshot?.head ? "." : " and no plan-time HEAD was available."),
  )
}

function objectiveAllowsRemote(objective: string, refs: string[]) {
  const text = objective.toLowerCase()
  if (/\borigin\b|\bupstream\b|@\{u|refs\/remotes\//i.test(text)) return true
  return refs.every((ref) => text.includes(ref.toLowerCase()))
}

function uniqueMatches(command: string, pattern: RegExp) {
  pattern.lastIndex = 0
  const found = command.match(pattern) ?? []
  pattern.lastIndex = 0
  return [...new Set(found)]
}

function rangeBeforeStates(command: string) {
  RANGE.lastIndex = 0
  const found: string[] = []
  let match: RegExpExecArray | null
  while ((match = RANGE.exec(command))) {
    if (match[1]) found.push(stripRev(match[1]))
  }
  RANGE.lastIndex = 0
  return [...new Set(found)]
}

function mergeBaseRevs(command: string) {
  MERGE_BASE.lastIndex = 0
  const found: string[] = []
  let match: RegExpExecArray | null
  while ((match = MERGE_BASE.exec(command))) {
    if (match[1]) found.push(stripRev(match[1]))
    if (match[2]) found.push(stripRev(match[2]))
  }
  MERGE_BASE.lastIndex = 0
  return [...new Set(found)]
}

function stripRev(rev: string) {
  return rev.replace(/^['"]+|['"]+$/g, "")
}

function parseAheadBehind(text: string | undefined): [number | undefined, number | undefined] {
  if (!text) return [undefined, undefined]
  const [left, right] = text.split(/\s+/, 2)
  const behind = Number.parseInt(left ?? "", 10)
  const ahead = Number.parseInt(right ?? "", 10)
  return [Number.isFinite(behind) ? behind : undefined, Number.isFinite(ahead) ? ahead : undefined]
}

function parsePorcelain(text: string) {
  const names: string[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trimEnd()
    if (trimmed.length < 4) continue
    names.push(trimmed.slice(3))
  }
  return names
}

function splitNames(text: string | undefined) {
  if (!text) return []
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function listBlock(title: string, names: string[]) {
  if (names.length === 0) return [`${title}: none`]
  const shown = names.slice(0, MAX_PATHS)
  const extra = names.length - shown.length
  const lines = [`${title}:`, ...shown.map((name) => `- ${name}`)]
  if (extra > 0) lines.push(`- and ${extra} more`)
  return lines
}
