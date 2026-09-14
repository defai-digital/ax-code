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

const GIT_INVOCATION = /\bgit\b|\bmerge-base\b|\$(?:\{GIT\}|GIT\b)/
const GIT_PATHSPEC_PREFIX = /(?:\bgit|\$\{GIT\}|\$GIT\b)(?:\s+[^\s]+)*\s--\s.*$/

function looksLikeGitCommand(command: string) {
  return GIT_INVOCATION.test(command)
}

function isGitRevisionSegment(part: string) {
  return GIT_INVOCATION.test(part)
}

function gitRevisionText(command: string) {
  // Only git / $GIT / ${GIT} / merge-base segments contribute before-states.
  // Later Unix `diff`/`grep origin/main` must not be treated as a git revision.
  return command
    .split(/\s*(?:&&|\|\||;|\||&)\s*/)
    .filter((part) => isGitRevisionSegment(part))
    .map(stripGitPathspec)
    .join(" ")
}

function stripGitPathspec(part: string) {
  return part.replace(GIT_PATHSPEC_PREFIX, (matched) => {
    const cut = matched.search(/\s--\s/)
    return cut === -1 ? matched : matched.slice(0, cut)
  })
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
