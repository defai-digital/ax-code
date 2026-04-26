/**
 * Agent auto-router
 *
 * Tiered routing: keyword matching (Tier 1, <1ms) with optional LLM
 * classification fallback (Tier 2, ~200-500ms) for ambiguous messages.
 */

import { generateObject } from "ai"
import { Log } from "../util/log"
import { Provider } from "../provider/provider"
import z from "zod"

const log = Log.create({ service: "agent.router" })

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function boundedPattern(keyword: string) {
  return new RegExp("\\b" + escapeRegex(keyword) + "\\b", "i")
}

interface RouteRule {
  agent: string
  keywords: RegExp[]
  patterns: RegExp[]
  intents: RegExp[]
  negatives: RegExp[]
  confidence: number
  readOnly: boolean
  requireIntent: boolean
}

function rule(input: {
  agent: string
  keywords: string[]
  patterns: RegExp[]
  intents?: string[]
  confidence: number
  negatives?: string[]
  readOnly?: boolean
  requireIntent?: boolean
}): RouteRule {
  return {
    agent: input.agent,
    keywords: input.keywords.map(boundedPattern),
    patterns: input.patterns,
    intents: (input.intents ?? []).map(boundedPattern),
    negatives: (input.negatives ?? []).map(boundedPattern),
    confidence: input.confidence,
    readOnly: input.readOnly ?? false,
    requireIntent: input.requireIntent ?? false,
  }
}

/** Words that signal the user wants code changes, not analysis.
 *  Applied as negatives to read-only agent rules (security, architect, perf). */
const ACTION_INTENT = [
  "restructure", "refactor", "fix", "update", "change", "modify",
  "rewrite", "convert", "migrate", "replace", "rename", "move",
  "improve", "clean up", "simplify", "extract", "inline",
  "split", "merge", "implement", "apply",
]

/** Investigation/inspection verbs shared by review-style intent profiles.
 *  Kept separate so REVIEW_INTENT and PERF_INTENT stay in lockstep when
 *  the team adopts new analysis vocabulary. */
const COMMON_ANALYSIS_INTENT = ["analyze", "investigate", "inspect", "review"]

const REVIEW_INTENT = [
  ...COMMON_ANALYSIS_INTENT,
  "analysis", "audit", "assess", "check", "scan", "report",
]

const DEBUG_INTENT = [
  "debug", "diagnose", "diagnostics", "investigate", "trace",
  "troubleshoot", "root cause", "stack trace", "exception",
]

const PERF_INTENT = [
  ...COMMON_ANALYSIS_INTENT,
  "profile", "benchmark", "measure", "diagnose",
]

const RULES: RouteRule[] = [
  rule({
    agent: "security",
    keywords: [
      "security", "vulnerability", "vulnerabilities", "cve", "owasp",
      "injection", "xss", "csrf", "auth audit", "secret", "secrets",
      "hardcoded", "exposed", "leak", "penetration", "pentest",
      "security scan", "security audit", "security review", "compliance",
    ],
    patterns: [
      /\bsecur(e|ity)\b/i,
      /\bvuln(erable|erabilit)/i,
      /\b(scan|audit|check)\b.*\b(security|auth|secret)/i,
      /\b(secret|key|token|password)\b.*\b(expos|leak|hardcod)/i,
    ],
    intents: REVIEW_INTENT,
    negatives: [...ACTION_INTENT, "test coverage", "test suite", "write tests", "unit test", "add tests"],
    confidence: 0.8,
    readOnly: true,
    requireIntent: true,
  }),
  rule({
    agent: "architect",
    keywords: [
      "architecture", "design pattern", "dependency", "dependencies",
      "coupling", "cohesion",
      "monorepo", "circular", "layering", "separation of concerns",
      "system design", "code organization",
    ],
    patterns: [
      /\barchitect(ure)?\b/i,
      /\b(design|code)\s+pattern/i,
      /\b(circular|cyclic)\s+dep/i,
      /\b(analyz\w*|review)\b.*\b(structure|design|organization)/i,
      /\bcoupling\b/i,
      /\bproject\s+structure\b/i,
      /\bpackages?\b.*\b(organiz|structur)/i,
    ],
    intents: REVIEW_INTENT,
    negatives: [...ACTION_INTENT, "build", "create", "scaffold", "generate", "new project", "from scratch", "set up", "initialize"],
    confidence: 0.8,
    readOnly: true,
    requireIntent: true,
  }),
  rule({
    agent: "debug",
    keywords: [
      "debug", "bug", "error", "crash", "failing", "broken",
      "not working", "doesn't work", "stack trace", "exception",
      "root cause", "investigate", "diagnose", "troubleshoot",
      "regression", "unexpected", "wrong output",
    ],
    patterns: [
      /\bdebug\b/i,
      /\b(fix|find|trace|investigate)\b.*\b(bug|error|crash|issue)/i,
      /\b(not|doesn.t|isn.t)\s+(work|function|run)/i,
      /\broot\s+cause\b/i,
      /\btroubleshoot/i,
      /\bstack\s+trace\b/i,
    ],
    intents: DEBUG_INTENT,
    negatives: ["test coverage", "write tests", "test plan", "test strategy", "build", "create", "scaffold", "new project", "from scratch"],
    confidence: 0.7,
    requireIntent: true,
  }),
  rule({
    agent: "perf",
    keywords: [
      "performance", "slow", "fast", "speed", "optimize", "optimization",
      "bottleneck", "memory leak", "profiling", "benchmark", "latency",
      "throughput", "complexity", "efficient", "inefficient",
      "memory usage", "cpu usage",
    ],
    patterns: [
      /\bperformance\b/i,
      /\b(optimi[zs]|speed\s+up|slow|bottleneck)/i,
      /\bmemory\s+(leak|usage)\b/i,
      /\bbenchmark/i,
      /\bO\([nN]/,
      /\bprofil(e|ing)\b/i,
    ],
    intents: PERF_INTENT,
    negatives: [...ACTION_INTENT, "build", "create", "scaffold", "new project", "from scratch", "set up"],
    confidence: 0.7,
    readOnly: true,
    requireIntent: true,
  }),
  rule({
    agent: "devops",
    keywords: [
      "docker", "dockerfile", "container", "kubernetes", "k8s", "helm",
      "ci/cd", "pipeline", "github actions", "gitlab ci", "jenkins",
      "deploy", "deployment", "infrastructure", "terraform", "pulumi",
      "cloudformation", "devops", "monitoring", "alerting", "grafana",
      "nginx", "reverse proxy", "load balancer", "health check",
      "rollback", "canary", "blue-green", "staging", "production",
    ],
    patterns: [
      /\bdocker(file|compose)?\b/i,
      /\bk(ubernetes|8s)\b/i,
      /\bci\/?cd\b/i,
      /\b(deploy|deployment|rollback)\b/i,
      /\b(terraform|pulumi|cloudformation|cdk)\b/i,
      /\bgithub\s+actions?\b/i,
      /\b(infra(structure)?|devops)\b/i,
      /\bhelm\b/i,
    ],
    negatives: ["test coverage", "test suite", "write tests", "unit test", "add tests"],
    confidence: 0.8,
  }),
  rule({
    agent: "test",
    keywords: [
      "tests", "testing", "unit test", "integration test",
      "test coverage", "coverage", "test suite", "test case",
      "test file", "spec", "specs", "assertion", "assertions",
      "mock", "mocking", "fixture", "fixtures", "tdd",
      "test driven", "write tests", "add tests", "missing tests",
      "untested", "test failure", "test infrastructure",
      "snapshot test", "regression test", "e2e test",
      "test plan", "test strategy",
    ],
    patterns: [
      /\b(write|add|create|generate|improve)\b.*\btests?\b/i,
      /\btest\s+(coverage|suite|file|case|plan|strategy)\b/i,
      /\b(unit|integration|regression|e2e|snapshot)\s+tests?\b/i,
      /\btdd\b/i,
      /\buntested\b/i,
      /\bcoverage\b.*\b(gap|improve|increase|analyze|report)\b/i,
      /\b(missing|need|lack)\b.*\btests?\b/i,
    ],
    negatives: ["vulnerability", "cve", "owasp", "deploy", "docker", "kubernetes", "security scan", "security audit"],
    confidence: 0.7,
  }),
  rule({
    agent: "react",
    keywords: [
      "step by step", "reason through", "think through", "systematically",
      "carefully analyze", "trace through", "investigate thoroughly",
      "complex debugging", "deliberate",
    ],
    patterns: [
      /\bstep[- ]by[- ]step\b/i,
      /\breason\s+(through|carefully|step)\b/i,
      /\bthink\s+(through|carefully|step)\b/i,
      /\bsystematic(ally)?\b.*\b(debug|analyz|investigat)/i,
      /\bdeliberate(ly)?\b.*\b(approach|analyz|reason)/i,
    ],
    intents: ["analyze", "investigate", "trace", "debug", "reason"],
    negatives: ["quick", "fast", "simple", "just", "briefly"],
    confidence: 0.6,
    requireIntent: true,
  }),
  rule({
    agent: "plan",
    keywords: [
      "plan", "planning", "roadmap", "design first", "outline",
      "before implementing", "think before", "draft a plan",
      "create a plan", "write a plan",
    ],
    patterns: [
      /\b(create|write|draft|make)\s+a?\s*plan\b/i,
      /\bplan\s+(out|the|this|before)\b/i,
      /\bdesign\s+(before|first|then)\b/i,
      /\boutline\s+(the|a|an)\s+(approach|solution|steps?)\b/i,
      /\bthink\s+before\s+(implement|cod|build)/i,
    ],
    intents: ["plan", "design", "outline", "draft"],
    negatives: ["refactor", "fix", "implement now", "just do", "do it"],
    confidence: 0.65,
    requireIntent: false,
  }),
]

export interface RouteResult {
  agent: string
  confidence: number
  matched: string[]
  complexity?: "low" | "medium" | "high"
}

/** Tier 1: Keyword + regex matching (<1ms) */
export function keywordRoute(message: string, currentAgent: string): RouteResult | null {
  let best: RouteResult | null = null

  for (const rule of RULES) {
    const matched: string[] = []
    let score = 0
    let intent = !rule.requireIntent

    for (const kw of rule.keywords) {
      if (kw.test(message)) {
        matched.push(kw.source)
        score += 1
      }
    }

    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        matched.push(pattern.source)
        score += 2
      }
    }

    for (const item of rule.intents) {
      if (item.test(message)) {
        matched.push(item.source)
        intent = true
      }
    }

    if (score === 0) continue
    if (!intent) continue

    // Read-only agents penalize action-intent words more heavily
    if (rule.readOnly && rule.negatives.some((neg) => neg.test(message))) continue
    const negWeight = rule.readOnly ? 2 : 1
    for (const neg of rule.negatives) {
      if (neg.test(message)) score -= negWeight
    }

    if (score <= 0) continue

    const confidence = rule.confidence * Math.min(1, score / 3)

    if (rule.agent === currentAgent) continue

    if (!best || confidence > best.confidence) {
      best = { agent: rule.agent, confidence, matched }
    }
  }

  if (best && best.confidence >= 0.4) {
    log.info("keyword-route", { agent: best.agent, confidence: best.confidence, matched: best.matched })
    return best
  }

  return null
}

const LLM_TIMEOUT = 1500

/** Max characters sent for classification. ~125 tokens is sufficient for intent detection. */
const CLASSIFY_MAX_CHARS = 500

const CLASSIFY_PROMPT = `You are an intent classifier for a coding assistant. Given a user message, classify which specialist agent should handle it, provide a confidence score, and estimate task complexity.

Agents:
- security: Vulnerability scanning, secrets, OWASP, compliance, auth audits (ANALYSIS ONLY — cannot edit code)
- architect: System design analysis, dependency mapping, coupling review (ANALYSIS ONLY — cannot edit code)
- debug: Bug investigation, error tracing, crash analysis, root cause finding
- perf: Performance analysis, profiling, benchmarks, memory leak detection (ANALYSIS ONLY — cannot edit code)
- devops: Docker, CI/CD, deployment, infrastructure, Kubernetes, monitoring
- test: Writing tests, test coverage, TDD, test infrastructure, fixtures, mocking
- react: Step-by-step deliberate reasoning — multi-step investigation, careful analysis requiring structured thinking
- plan: Planning before implementing — creating roadmaps, design outlines, or solution drafts before writing any code
- none: General coding, refactoring, or any task requiring direct code changes

IMPORTANT: If the user wants to CHANGE, FIX, REFACTOR, or MODIFY code, classify as "none" even if the topic relates to security, architecture, or performance. Only use analysis agents when the user wants a review, audit, or report without code changes.

Complexity:
- low: Simple lookup, one-liner explanation, or basic question — minimal reasoning required
- medium: Moderate reasoning, multi-file analysis, or standard debugging
- high: Complex architecture decisions, deep investigation, or large-scale changes

Respond with the agent name, a confidence score (0.0 to 1.0), and complexity level.`

const classifySchema = z.object({
  agent: z.enum(["security", "architect", "debug", "perf", "devops", "test", "react", "plan", "none"]),
  confidence: z.number().min(0).max(1),
  complexity: z.enum(["low", "medium", "high"]).optional(),
})

interface LLMClassification {
  agent: string | null
  confidence: number
  matched: string[]
  complexity: "low" | "medium" | "high" | null
}

/** Tier 2: LLM classification — returns agent intent AND complexity in one call */
async function classifyWithLLM(message: string, currentAgent: string): Promise<LLMClassification | null> {
  const model = await Provider.defaultModel()
  const small = await Provider.getSmallModel(model.providerID)
  if (!small) {
    log.info("llm-route-skipped", { reason: "no-small-model" })
    return null
  }
  const language = await Provider.getLanguage(small)

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), LLM_TIMEOUT)
  try {
    const result = await generateObject({
      model: language,
      temperature: 0,
      schema: classifySchema,
      abortSignal: abort.signal,
      messages: [
        { role: "system" as const, content: CLASSIFY_PROMPT },
        { role: "user" as const, content: message.slice(0, CLASSIFY_MAX_CHARS) },
      ],
    }).then((r) => r.object)

    // Agent is null when "none", same as current, or low confidence — but we still carry complexity
    const agent =
      result.agent === "none" || result.agent === currentAgent || result.confidence < 0.3
        ? null
        : result.agent

    log.info("llm-classify", { agent, confidence: result.confidence, complexity: result.complexity })
    return { agent, confidence: result.confidence, matched: ["llm-classification"], complexity: result.complexity ?? null }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Route a user message to the best matching agent.
 * Tier 1: keyword matching (<1ms). If confidence >= 0.5, route immediately.
 * Tier 2: LLM classification (opt-in via config.routing.llm) for ambiguous cases.
 */
export async function route(message: string, currentAgent: string): Promise<RouteResult | null> {
  // Tier 1: keyword routing
  const keyword = keywordRoute(message, currentAgent)
  if (keyword && keyword.confidence >= 0.5) return keyword

  // Short messages: skip LLM fallback and keep any keyword result.
  if (message.length < 30) return keyword

  // Check if LLM fallback is enabled (set by server via env var)
  if (process.env["AX_CODE_SMART_LLM"] !== "true") return keyword

  const llm = await classifyWithLLM(message, currentAgent).catch((err) => {
    log.info("llm-route-failed", { error: String(err) })
    return null
  })

  if (!llm?.agent) return keyword
  return { agent: llm.agent, confidence: llm.confidence, matched: llm.matched, complexity: llm.complexity ?? undefined }
}

/**
 * Analyse a message for both agent routing AND complexity classification in one pass.
 *
 * Unlike `route()`, this function always returns complexity when SmartLLM is on — even
 * when no agent switch is needed. This is what enables model-tier routing: simple
 * general questions (no specialist match) get `complexity: "low"` and can use a fast model.
 *
 * Activation logic:
 * - High-confidence keyword match → trust keyword routing, skip LLM (no added latency)
 * - Low/no keyword match + SmartLLM on → call LLM once for BOTH agent and complexity
 * - SmartLLM off → keyword routing only, no complexity
 */
export interface MessageAnalysis {
  route: RouteResult | null
  complexity: "low" | "medium" | "high" | null
}

export async function analyzeMessage(message: string, currentAgent: string): Promise<MessageAnalysis> {
  const keyword = keywordRoute(message, currentAgent)

  // SmartLLM disabled: keyword routing only, no complexity (guard must come first)
  if (process.env["AX_CODE_SMART_LLM"] !== "true") return { route: keyword, complexity: null }

  // Very short messages: trivially simple — skip LLM, treat as low complexity
  if (message.length < 30) return { route: keyword, complexity: "low" }

  // High-confidence keyword hit: agent is already known — skip LLM to avoid latency.
  // These are clear specialist requests (debug, test, devops…) that warrant the full model anyway.
  if (keyword && keyword.confidence >= 0.5) return { route: keyword, complexity: null }

  // Ambiguous or no keyword match: one LLM call covers both routing and complexity.
  // This is the key path for "simple general questions → fast model".
  const llm = await classifyWithLLM(message, currentAgent).catch((err) => {
    log.info("llm-analyze-failed", { error: String(err) })
    return null
  })

  if (!llm) return { route: keyword, complexity: null }

  const agentRoute = llm.agent
    ? { agent: llm.agent, confidence: llm.confidence, matched: llm.matched, complexity: llm.complexity ?? undefined }
    : keyword

  return { route: agentRoute, complexity: llm.complexity ?? null }
}
