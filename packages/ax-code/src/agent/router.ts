/**
 * Agent auto-router
 * Ported from ax-cli's agent-router.ts
 *
 * Automatically selects the best agent based on user message keywords.
 * Falls back to the current/default agent if no match is found.
 */

import { Log } from "../util/log"

const log = Log.create({ service: "agent.router" })

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
    confidence: 0.8,
  },
  {
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
      /\b(analyz|review)\b.*\b(structure|design|organization)/i,
      /\bcoupling\b/i,
    ],
    confidence: 0.8,
  },
  {
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
    confidence: 0.7,
  },
  {
    agent: "perf",
    keywords: [
      "performance", "slow", "fast", "speed", "optimize", "optimization",
      "bottleneck", "memory leak", "profiling", "benchmark", "latency",
      "throughput", "complexity", "O(n", "efficient", "inefficient",
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
  },
  {
    agent: "react",
    keywords: [
      "step by step", "think through", "reason through",
      "walk me through", "explain your reasoning",
    ],
    patterns: [
      /\bstep\s+by\s+step\b/i,
      /\b(think|reason|walk)\b.*\b(through|carefully)\b/i,
    ],
    confidence: 0.6,
  },
  {
    agent: "plan",
    keywords: [
      "plan", "planning", "strategy", "approach", "design",
      "how should", "what approach", "propose",
    ],
    patterns: [
      /\b(plan|strateg|approach)\b.*\b(for|to|how)\b/i,
      /\bhow\s+should\s+(i|we)\b/i,
    ],
    confidence: 0.5,
  },
]

export interface RouteResult {
  agent: string
  confidence: number
  matched: string[]
}

/**
 * Route a user message to the best matching agent
 * Returns null if no confident match (use default agent)
 */
export function route(message: string, currentAgent: string): RouteResult | null {
  const lower = message.toLowerCase()
  let best: RouteResult | null = null

  for (const rule of RULES) {
    const matched: string[] = []
    let score = 0

    // Keyword matching
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword)) {
        matched.push(keyword)
        score += 1
      }
    }

    // Pattern matching (higher weight)
    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        matched.push(pattern.source)
        score += 2
      }
    }

    if (score === 0) continue

    // Calculate confidence based on matches
    const confidence = Math.min(rule.confidence, score * 0.15)

    // Skip if same as current agent
    if (rule.agent === currentAgent) continue

    // Keep best match
    if (!best || confidence > best.confidence) {
      best = { agent: rule.agent, confidence, matched }
    }
  }

  // Only route if confidence is above threshold
  if (best && best.confidence >= 0.3) {
    log.info("auto-route", { agent: best.agent, confidence: best.confidence, matched: best.matched })
    return best
  }

  return null
}

/**
 * Get a suggestion message for the user when auto-routing would switch agents
 */
export function suggest(result: RouteResult): string {
  return `Tip: The "${result.agent}" agent might be better for this task. Press Tab to switch.`
}
