/**
 * Request complexity detection
 * Ported from ax-cli's planning-prompt.ts complexity functions
 *
 * Determines whether a user request should trigger multi-phase planning
 */

const COMPLEX_KEYWORDS = [
  "refactor",
  "implement",
  "migrate",
  "rewrite",
  "restructure",
  "redesign",
  "add feature",
  "build",
  "create",
  "set up",
  "integrate",
  "convert",
  "upgrade",
  "test suite",
  "end-to-end",
]

const SIMPLE_KEYWORDS = ["fix", "rename", "update", "change", "remove", "delete", "add", "typo", "move"]

const MULTI_FILE_INDICATORS = [
  "all files",
  "across the",
  "every file",
  "throughout",
  "entire project",
  "codebase",
  "multiple files",
]

const STEP_INDICATORS = ["first", "then", "next", "after", "finally", "step", "phase", "before", "followed by"]

/** Optional pre-computed signal from the router or another upstream classifier. */
export type ComplexityHint = "low" | "medium" | "high"

/**
 * Determine if a request is complex enough to warrant multi-phase planning.
 *
 * When `hint` is supplied (e.g. by the router that already classified the
 * message), it acts as a floor/ceiling on the keyword-only decision:
 *   - "high": always complex
 *   - "low":  treated as simple unless multi-file or multi-step keywords are present
 *   - "medium": no override; keyword logic decides
 */
export function isComplex(request: string, hint?: ComplexityHint): boolean {
  const lower = request.toLowerCase()
  const multiFile = hasMultiFile(lower)
  const multiStep = hasMultiStep(lower)

  if (hint === "high") return true
  if (hint === "low" && !multiFile && !multiStep) return false

  // Short requests are simple
  if (request.length < 50) return false

  // Check for simple override
  const hasSimple = SIMPLE_KEYWORDS.some((k) => lower.includes(k))
  const hasComplex = COMPLEX_KEYWORDS.some((k) => lower.includes(k))

  if (hasSimple && !hasComplex && !multiFile && !multiStep) return false

  // Complex if: complex keywords, multi-file, multi-step, or long
  return hasComplex || multiFile || multiStep || request.length > 300
}

/**
 * Get complexity score 0-100. When `hint` is supplied, the keyword-only score
 * is adjusted: "high" raises the floor to 65, "low" caps the ceiling at 35,
 * "medium" adds a small bonus to break ties.
 */
export function score(request: string, hint?: ComplexityHint): number {
  const lower = request.toLowerCase()
  let s = 0

  // Length contribution (max +20)
  s += Math.min(20, Math.floor(request.length / 15))

  // Complex keywords (max +30)
  const complexCount = COMPLEX_KEYWORDS.filter((k) => lower.includes(k)).length
  s += Math.min(30, complexCount * 10)

  // Multi-file indicators (max +15)
  if (hasMultiFile(lower)) s += 15

  // Step indicators (max +15)
  const stepCount = STEP_INDICATORS.filter((k) => lower.includes(k)).length
  s += Math.min(15, stepCount * 5)

  // Multiple distinct tasks (max +20)
  const taskCount = countDistinctTasks(lower)
  s += Math.min(20, (taskCount - 1) * 10)

  if (hint === "high") s = Math.max(s, 65)
  else if (hint === "low") s = Math.min(s, 35)
  else if (hint === "medium") s += 5

  return Math.min(100, Math.max(0, s))
}

/**
 * Estimate minimum number of phases needed
 */
export function minPhases(request: string): number {
  const lower = request.toLowerCase()
  const actions = [
    "create",
    "test",
    "document",
    "refactor",
    "implement",
    "add",
    "update",
    "remove",
    "configure",
    "deploy",
  ]
  const count = actions.filter((a) => lower.includes(a)).length
  const steps = STEP_INDICATORS.filter((k) => lower.includes(k)).length
  return Math.max(1, Math.min(5, Math.max(count, Math.ceil(steps / 2))))
}

function hasMultiFile(lower: string): boolean {
  return MULTI_FILE_INDICATORS.some((k) => lower.includes(k))
}

function hasMultiStep(lower: string): boolean {
  return STEP_INDICATORS.filter((k) => lower.includes(k)).length >= 2
}

function countDistinctTasks(lower: string): number {
  // Count numbered items (1. xxx 2. xxx) or comma-separated actions
  const numbered = lower.match(/\d+\.\s/g)?.length ?? 0
  if (numbered >= 2) return numbered

  const actions = ["create", "test", "document", "refactor", "implement", "add", "update", "remove"]
  return Math.max(1, actions.filter((a) => lower.includes(a)).length)
}
