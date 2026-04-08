/**
 * Failure detector for self-correction system
 * Ported from ax-cli's failure-detector.ts
 *
 * Detects tool execution failures and classifies them with recovery strategies
 */

export type FailureType =
  | "tool_error"
  | "repeated_failure"
  | "loop_detected"
  | "no_progress"
  | "validation_error"
  | "timeout"

export type Severity = "low" | "medium" | "high" | "critical"

export type RecoveryStrategy =
  | "retry"
  | "reread_and_retry"
  | "search_alternative"
  | "broaden_search"
  | "simplify"
  | "different_approach"
  | "verify_first"
  | "escalate"

export interface FailureSignal {
  type: FailureType
  severity: Severity
  toolName: string
  error: string
  attempt: number
  recoverable: boolean
  strategy: RecoveryStrategy
  suggestion: string
  maxRetries: number
}

interface Pattern {
  match: RegExp
  strategy: RecoveryStrategy
  maxRetries: number
  suggestion: string
}

const PATTERNS: Pattern[] = [
  // File system errors
  { match: /ENOENT|file not found|no such file/i, strategy: "search_alternative", maxRetries: 2, suggestion: "File not found — search for the correct path" },
  { match: /EACCES|permission denied/i, strategy: "escalate", maxRetries: 0, suggestion: "Permission denied — cannot recover automatically" },
  { match: /EEXIST|already exists/i, strategy: "different_approach", maxRetries: 1, suggestion: "File already exists — try a different approach" },

  // Edit/replace errors
  { match: /old_string not found|no match found/i, strategy: "reread_and_retry", maxRetries: 2, suggestion: "String not found — re-read the file and check exact content" },
  { match: /multiple matches|not unique/i, strategy: "reread_and_retry", maxRetries: 2, suggestion: "Multiple matches — provide more surrounding context to make it unique" },
  { match: /must read.*before/i, strategy: "verify_first", maxRetries: 1, suggestion: "Read the file first before editing" },

  // Search errors
  { match: /no matches found|no results/i, strategy: "broaden_search", maxRetries: 3, suggestion: "No results — try broader search terms or different patterns" },
  { match: /invalid regex|invalid pattern/i, strategy: "simplify", maxRetries: 2, suggestion: "Invalid pattern — simplify the regex" },
  { match: /too many results/i, strategy: "simplify", maxRetries: 2, suggestion: "Too many results — narrow the search" },

  // Validation errors
  { match: /parse error|invalid json|syntax error/i, strategy: "verify_first", maxRetries: 2, suggestion: "Parse error — verify the content format" },
  { match: /type error|type mismatch/i, strategy: "reread_and_retry", maxRetries: 2, suggestion: "Type error — re-read and fix the types" },

  // Command errors
  { match: /command not found/i, strategy: "different_approach", maxRetries: 1, suggestion: "Command not found — try an alternative command" },
  { match: /timeout|timed out/i, strategy: "retry", maxRetries: 1, suggestion: "Operation timed out — try with shorter input or break into steps" },
  { match: /exit code [1-9]|non-zero exit/i, strategy: "reread_and_retry", maxRetries: 2, suggestion: "Command failed — check output and fix the issue" },

  // Compile/build errors
  { match: /compile error|build failed|tsc.*error/i, strategy: "reread_and_retry", maxRetries: 2, suggestion: "Compilation failed — fix the errors shown in output" },
  { match: /test.*fail|assertion.*fail|expect.*received/i, strategy: "reread_and_retry", maxRetries: 2, suggestion: "Test failed — review the assertion and fix the code" },

  // Permission errors
  { match: /prevents you from using this specific tool call|read-only and cannot modify/i, strategy: "escalate", maxRetries: 0, suggestion: "This agent is read-only. Suggest the user switch to the Dev agent to make code changes." },

  // Git errors
  { match: /merge conflict/i, strategy: "escalate", maxRetries: 0, suggestion: "Merge conflict — needs manual resolution" },
  { match: /uncommitted changes/i, strategy: "escalate", maxRetries: 0, suggestion: "Uncommitted changes — commit or stash first" },
]

export function detect(toolName: string, error: string, attempt: number): FailureSignal {
  for (const pattern of PATTERNS) {
    if (pattern.match.test(error)) {
      const severity = getSeverity(attempt)
      return {
        type: classifyType(error),
        severity,
        toolName,
        error,
        attempt,
        recoverable: severity !== "critical" && attempt < pattern.maxRetries + 1,
        strategy: pattern.strategy,
        suggestion: pattern.suggestion,
        maxRetries: pattern.maxRetries,
      }
    }
  }

  // Default: generic tool error
  return {
    type: "tool_error",
    severity: getSeverity(attempt),
    toolName,
    error,
    attempt,
    recoverable: attempt < 3,
    strategy: "retry",
    suggestion: "Operation failed — review the error and try again",
    maxRetries: 2,
  }
}

function getSeverity(attempt: number): Severity {
  if (attempt >= 5) return "critical"
  if (attempt >= 3) return "high"
  if (attempt >= 2) return "medium"
  return "low"
}

function classifyType(error: string): FailureType {
  if (/timeout|timed out/i.test(error)) return "timeout"
  if (/parse|syntax|type error|validation/i.test(error)) return "validation_error"
  return "tool_error"
}
