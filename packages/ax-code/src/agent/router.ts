/**
 * Agent auto-router.
 *
 * Modeled after v2.x's keyword router, which users perceived as "working" because
 * its simplicity meant it actually fired. v3+ piled on intent-required gates,
 * negative-keyword blockers, an LLM tier, switch/delegate modes, and read-only
 * specialist restrictions — each well-intentioned, the cumulative effect was a
 * feature that almost never fired and confused users when it did. We removed all
 * of it once and brought it back here in the simpler v2 shape.
 *
 * Two independent functions:
 * - `route()`        — sync, keyword-only, fires whenever a topic keyword matches
 * - `classifyComplexity()` — async LLM call, separate concern (fast-model selection)
 */

import { generateObject } from "ai"
import { Log } from "../util/log"
import { Provider } from "../provider/provider"
import z from "zod"

const log = Log.create({ service: "agent.router" })

// ---------------- Keyword routing (v2-style) ----------------

interface RouteRule {
  agent: string
  keywords: string[]
  patterns: RegExp[]
  confidence: number
}

const RULES: RouteRule[] = [
  {
    agent: "security",
    keywords: [
      "security",
      "vulnerability",
      "vulnerabilities",
      "cve",
      "owasp",
      "injection",
      "xss",
      "csrf",
      "auth audit",
      "secret",
      "secrets",
      "hardcoded",
      "exposed",
      "leak",
      "penetration",
      "pentest",
      "security scan",
      "security audit",
      "security review",
      "compliance",
    ],
    patterns: [
      /\bsecur(e|ity)\b/i,
      /\bvuln(erable|erabilit)/i,
      /\b(scan|audit|check)\b.*\b(security|auth|secret)/i,
      /\b(secret|key|token|password)\b.*\b(expos|leak|hardcod)/i,
    ],
    confidence: 0.8,
  },
  {
    agent: "architect",
    keywords: [
      "architecture",
      "design pattern",
      "dependency",
      "dependencies",
      "coupling",
      "cohesion",
      "monorepo",
      "circular",
      "layering",
      "separation of concerns",
      "system design",
      "code organization",
    ],
    patterns: [
      /\barchitect(ure)?\b/i,
      /\b(design|code)\s+pattern/i,
      /\b(circular|cyclic)\s+dep/i,
      /\b(analyz\w*|review)\b.*\b(structure|design|organization)/i,
      /\bcoupling\b/i,
      /\bproject\s+structure\b/i,
    ],
    confidence: 0.8,
  },
  {
    agent: "debug",
    keywords: [
      "debug",
      "bug",
      "error",
      "crash",
      "failing",
      "broken",
      "not working",
      "doesn't work",
      "stack trace",
      "exception",
      "root cause",
      "investigate",
      "diagnose",
      "troubleshoot",
      "regression",
      "wrong output",
    ],
    patterns: [
      /\bdebug\b/i,
      /\b(fix|find|trace|investigate)\b.*\b(bug|error|crash|issue)/i,
      /\b(not|doesn.t|isn.t)\s+(work|function|run)/i,
      /\broot\s+cause\b/i,
      /\btroubleshoot/i,
      /\bstack\s+trace\b/i,
    ],
    confidence: 0.7,
  },
  {
    agent: "perf",
    keywords: [
      "performance",
      "bottleneck",
      "memory leak",
      "profiling",
      "benchmark",
      "latency",
      "throughput",
      "memory usage",
      "cpu usage",
    ],
    patterns: [
      /\bperformance\b/i,
      /\b(optimi[zs]|speed\s+up|bottleneck)/i,
      /\bmemory\s+(leak|usage)\b/i,
      /\bbenchmark/i,
      /\bO\([nN]/,
      /\bprofil(e|ing)\b/i,
    ],
    confidence: 0.7,
  },
  {
    agent: "devops",
    keywords: [
      "docker",
      "dockerfile",
      "kubernetes",
      "k8s",
      "helm",
      "ci/cd",
      "github actions",
      "gitlab ci",
      "jenkins",
      "deploy",
      "deployment",
      "infrastructure",
      "terraform",
      "pulumi",
      "cloudformation",
      "devops",
      "rollback",
      "canary",
      "blue-green",
    ],
    patterns: [
      /\bdocker(file|compose)?\b/i,
      /\bk(ubernetes|8s)\b/i,
      /\bci\/?cd\b/i,
      /\b(deploy|deployment|rollback)\b/i,
      /\b(terraform|pulumi|cloudformation|cdk)\b/i,
      /\bgithub\s+actions?\b/i,
      /\b(infra(structure)?|devops)\b/i,
    ],
    confidence: 0.8,
  },
  {
    agent: "test",
    keywords: [
      "unit test",
      "integration test",
      "test coverage",
      "test suite",
      "test case",
      "tdd",
      "test driven",
      "write tests",
      "add tests",
      "missing tests",
      "untested",
      "test failure",
      "snapshot test",
      "regression test",
      "e2e test",
    ],
    patterns: [
      /\b(write|add|create|generate)\b.*\btests?\b/i,
      /\btest\s+(coverage|suite|file|case|plan|strategy)\b/i,
      /\b(unit|integration|regression|e2e|snapshot)\s+tests?\b/i,
      /\btdd\b/i,
      /\buntested\b/i,
      /\b(missing|need|lack)\b.*\btests?\b/i,
    ],
    confidence: 0.7,
  },
]

export interface RouteResult {
  agent: string
  confidence: number
  matched: string[]
}

/**
 * Pick the best specialist agent for a message based on keyword/regex matches.
 * Returns null if no rule matches with confidence ≥ 0.4 or the best match equals
 * the current agent (no change needed).
 */
export function route(message: string, currentAgent: string): RouteResult | null {
  const lower = message.toLowerCase()
  let best: RouteResult | null = null

  for (const rule of RULES) {
    if (rule.agent === currentAgent) continue
    const matched: string[] = []
    let score = 0

    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        matched.push(kw)
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
    const confidence = rule.confidence * Math.min(1, score / 3)
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

// ---------------- Complexity classification (LLM-backed, separate) ----------------

const LLM_TIMEOUT = 1500
const CLASSIFY_MAX_CHARS = 500

const COMPLEXITY_PROMPT = `You are a message complexity classifier for a coding assistant. Given a user message, estimate how much reasoning the answer needs.

Levels:
- low: Simple lookup, one-liner explanation, or basic question — minimal reasoning required
- medium: Moderate reasoning, multi-file analysis, or standard debugging
- high: Complex architecture decisions, deep investigation, or large-scale changes

Respond with the complexity level only.`

const complexitySchema = z.object({
  complexity: z.enum(["low", "medium", "high"]),
})

export interface MessageAnalysis {
  complexity: "low" | "medium" | "high" | null
}

export async function classifyComplexity(message: string): Promise<MessageAnalysis> {
  if (process.env["AX_CODE_SMART_LLM"] !== "true") return { complexity: null }
  if (message.length < 30) return { complexity: "low" }

  const defaultModel = await Provider.defaultModel().catch(() => undefined)
  if (!defaultModel) return { complexity: null }
  const small = await Provider.getSmallModel(defaultModel.providerID)
  if (!small) {
    log.info("complexity-skipped", { reason: "no-small-model" })
    return { complexity: null }
  }
  const language = await Provider.getLanguage(small)

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), LLM_TIMEOUT)
  try {
    const result = await generateObject({
      model: language,
      temperature: 0,
      schema: complexitySchema,
      abortSignal: abort.signal,
      messages: [
        { role: "system" as const, content: COMPLEXITY_PROMPT },
        { role: "user" as const, content: message.slice(0, CLASSIFY_MAX_CHARS) },
      ],
    }).then((r) => r.object)

    log.info("complexity-classify", { complexity: result.complexity })
    return { complexity: result.complexity }
  } catch (err) {
    log.info("complexity-failed", { error: String(err) })
    return { complexity: null }
  } finally {
    clearTimeout(timer)
  }
}
