/**
 * Clarification Helpers
 *
 * Lightweight scaffolding for agents that want to opportunistically detect
 * ambiguity in a request and produce a structured clarification question.
 *
 * The full multi-turn loop lives in the agent layer (which calls Question.ask
 * with the result of `build()`); this module only provides the heuristics and
 * the prompt-shape constructor so callers can stay declarative.
 */

/** Structural shape of `Question.Info` — defined here to avoid a circular import. */
export interface QuestionInfoShape {
  question: string
  header: string
  options: { label: string; description: string }[]
  multiple?: boolean
  custom?: boolean
}

/** Verbs that frequently appear without a concrete object, e.g. "refactor X" without scope. */
const VAGUE_ACTION_VERBS = [
  "refactor",
  "improve",
  "clean up",
  "rewrite",
  "redesign",
  "restructure",
  "modernize",
  "migrate",
  "fix",
  "tune",
  "polish",
  "simplify",
  "optimize",
]

/** Phrases that explicitly defer the decision to the assistant — strong ambiguity signals. */
const EXPLICIT_AMBIGUITY = [
  "you decide",
  "your call",
  "whatever",
  "however you want",
  "i don't care",
  "not sure",
  "any way",
  "any approach",
  "best approach",
  "best way",
  "what do you think",
]

/** Specifiers that narrow scope. Their presence reduces ambiguity. */
const SCOPE_ANCHORS = [
  /\bin\s+[\w./@-]+/i, // "in src/foo"
  /\bfile[s]?\s+[\w./@-]+/i,
  /\b[\w-]+\.[a-z0-9]+\b/i, // any path-like token with extension
  /\bonly\s+\w+/i,
  /\bexactly\b/i,
  /\bspecifically\b/i,
  /\bbut\s+keep\b/i,
  /\bbut\s+do\s+not\b/i,
]

export interface ClarifyHint {
  reason: "vague-action" | "explicit-ambiguity" | "broad-scope"
  evidence: string
}

/**
 * Heuristic ambiguity detection. Returns a hint when the message would
 * benefit from a clarification question; null when the request is concrete
 * enough to act on.
 *
 * This is intentionally conservative — false positives waste user time, so
 * the rule is: trigger only when there's a clear vague-action verb without a
 * scope anchor, or an explicit "you decide" phrase.
 */
export function detectAmbiguity(message: string): ClarifyHint | null {
  const trimmed = message.trim()
  if (trimmed.length === 0) return null
  const lower = trimmed.toLowerCase()

  for (const phrase of EXPLICIT_AMBIGUITY) {
    if (lower.includes(phrase)) return { reason: "explicit-ambiguity", evidence: phrase }
  }

  const hasAnchor = SCOPE_ANCHORS.some((pattern) => pattern.test(trimmed))
  if (hasAnchor) return null

  for (const verb of VAGUE_ACTION_VERBS) {
    const pattern = new RegExp(`\\b${verb}\\b`, "i")
    if (pattern.test(trimmed)) return { reason: "vague-action", evidence: verb }
  }

  // Very short messages with no action verb and no scope anchor — broad request.
  if (trimmed.length < 30 && !/[?!.]$/.test(trimmed)) {
    return { reason: "broad-scope", evidence: "short request without scope" }
  }

  return null
}

export function shouldClarify(message: string): boolean {
  return detectAmbiguity(message) !== null
}

export interface ClarifyOption {
  label: string
  description: string
}

export interface ClarifyInput {
  /** What the question is about — used to phrase the prompt. */
  topic: string
  /** Why the assistant needs the answer — surfaced as the question body. */
  why: string
  /** Two to four mutually exclusive options. The first option is the recommended one. */
  options: ClarifyOption[]
  /** Optional override for the chip header (max 30 chars). */
  header?: string
  /** Allow multiple selections. */
  multiple?: boolean
  /** Allow free-text custom answer (default true). */
  custom?: boolean
}

/**
 * Build a `Question.Info` for ambiguity resolution.
 *
 * Convention: the first option is the recommended one and gets a "(Recommended)"
 * suffix so autonomous mode picks it. Description text should explain the
 * concrete consequence of each choice, not just restate the label.
 */
export function build(input: ClarifyInput): QuestionInfoShape {
  if (input.options.length < 2) throw new Error("clarify: need at least 2 options")
  if (input.options.length > 4) throw new Error("clarify: at most 4 options")

  const header = (input.header ?? input.topic).slice(0, 30)
  const [first, ...rest] = input.options
  const annotated = [
    { label: ensureRecommended(first.label), description: first.description },
    ...rest.map((o) => ({ label: o.label, description: o.description })),
  ]

  return {
    question: input.why,
    header,
    options: annotated,
    multiple: input.multiple,
    custom: input.custom,
  }
}

function ensureRecommended(label: string): string {
  return label.includes("(Recommended)") ? label : `${label} (Recommended)`
}
