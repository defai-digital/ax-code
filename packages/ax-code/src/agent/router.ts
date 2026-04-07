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
  negatives: RegExp[]
  confidence: number
}

function rule(input: {
  agent: string
  keywords: string[]
  patterns: RegExp[]
  confidence: number
  negatives?: string[]
}): RouteRule {
  return {
    agent: input.agent,
    keywords: input.keywords.map(boundedPattern),
    patterns: input.patterns,
    negatives: (input.negatives ?? []).map(boundedPattern),
    confidence: input.confidence,
  }
}

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
    negatives: ["test coverage", "test suite", "write tests", "unit test", "add tests"],
    confidence: 0.8,
  }),
  rule({
    agent: "architect",
    keywords: [
      "architecture", "design pattern", "dependency", "dependencies",
      "coupling", "cohesion", "module", "structure", "restructure",
      "monorepo", "circular", "layering", "separation of concerns",
      "system design", "code organization", "refactor architecture",
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
    confidence: 0.8,
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
    negatives: ["test coverage", "write tests", "test plan", "test strategy"],
    confidence: 0.7,
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
    confidence: 0.7,
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
  // react and plan are reasoning MODES, not topic domains
  // Users should explicitly switch to them (e.g., /react, /plan)
]

export interface RouteResult {
  agent: string
  confidence: number
  matched: string[]
}

/** Tier 1: Keyword + regex matching (<1ms) */
export function keywordRoute(message: string, currentAgent: string): RouteResult | null {
  let best: RouteResult | null = null

  for (const rule of RULES) {
    const matched: string[] = []
    let score = 0

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

    if (score === 0) continue

    for (const neg of rule.negatives) {
      if (neg.test(message)) score -= 1
    }

    if (score <= 0) continue

    const confidence = rule.confidence * Math.min(1, score / 3)

    if (rule.agent === currentAgent) continue

    if (!best || confidence > best.confidence) {
      best = { agent: rule.agent, confidence, matched }
    }
  }

  if (best && best.confidence >= 0.3) {
    log.info("keyword-route", { agent: best.agent, confidence: best.confidence, matched: best.matched })
    return best
  }

  return null
}

const LLM_TIMEOUT = 1500

/** Max characters sent for classification. ~125 tokens is sufficient for intent detection. */
const CLASSIFY_MAX_CHARS = 500

const CLASSIFY_PROMPT = `You are an intent classifier for a coding assistant. Given a user message, classify which specialist agent should handle it and provide a confidence score.

Agents:
- security: Vulnerability scanning, secrets, OWASP, compliance, auth audits
- architect: System design, dependencies, coupling, code organization, design patterns
- debug: Bug investigation, error tracing, crash analysis, root cause finding
- perf: Performance optimization, bottlenecks, profiling, benchmarks, memory leaks
- devops: Docker, CI/CD, deployment, infrastructure, Kubernetes, monitoring
- test: Writing tests, test coverage, TDD, test infrastructure, fixtures, mocking
- none: General coding, not a specialist task

Respond with the agent name and a confidence score (0.0 to 1.0) indicating how certain you are.`

const classifySchema = z.object({
  agent: z.enum(["security", "architect", "debug", "perf", "devops", "test", "none"]),
  confidence: z.number().min(0).max(1),
})

/** Tier 2: LLM classification fallback (~200-500ms) */
async function classifyWithLLM(message: string, currentAgent: string): Promise<RouteResult | null> {
  const model = await Provider.defaultModel()
  const small = await Provider.getSmallModel(model.providerID)
  if (!small) {
    log.info("llm-route-skipped", { reason: "no-small-model" })
    return null
  }
  const language = await Provider.getLanguage(small)

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), LLM_TIMEOUT)
  let result: z.infer<typeof classifySchema>
  try {
    result = await generateObject({
      model: language,
      temperature: 0,
      schema: classifySchema,
      abortSignal: abort.signal,
      messages: [
        { role: "system" as const, content: CLASSIFY_PROMPT },
        { role: "user" as const, content: message.slice(0, CLASSIFY_MAX_CHARS) },
      ],
    }).then((r) => r.object)
  } finally {
    clearTimeout(timer)
  }

  if (result.agent === "none" || result.agent === currentAgent) return null
  if (result.confidence < 0.3) return null

  log.info("llm-route", { agent: result.agent, confidence: result.confidence })
  return { agent: result.agent, confidence: result.confidence, matched: ["llm-classification"] }
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

  // No keyword matches at all — message is generic, skip LLM
  if (!keyword) return null

  // Tier 2 only applies for substantial messages with low keyword confidence
  if (message.length < 30) return keyword

  // Check if LLM fallback is enabled (set by server via env var)
  if (process.env["AX_CODE_SMART_LLM"] !== "true") return keyword

  const llm = await classifyWithLLM(message, currentAgent).catch((err) => {
    log.info("llm-route-failed", { error: String(err) })
    return null
  })

  return llm ?? keyword
}
