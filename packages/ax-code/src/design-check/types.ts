/**
 * Design Check Types
 */

export type Severity = "error" | "warn" | "off"

export interface RuleConfig {
  "no-hardcoded-colors": Severity
  "no-raw-spacing": Severity
  "no-inline-styles": Severity
  "missing-alt-text": Severity
  "missing-form-labels": Severity
}

export interface DesignCheckConfig {
  rules: Partial<RuleConfig>
  include: string[]
  ignore: string[]
  tokens?: {
    spacing?: string[]
    colors?: Record<string, string>
  }
}

export interface Violation {
  rule: string
  severity: Severity
  file: string
  line: number
  column: number
  message: string
  fix?: { from: string; to: string }
}

export interface FileResult {
  file: string
  violations: Violation[]
}

export interface CheckResult {
  files: FileResult[]
  summary: {
    filesScanned: number
    totalErrors: number
    totalWarnings: number
  }
}

export interface Rule {
  name: string
  description: string
  defaultSeverity: Severity
  check(content: string, file: string): Violation[]
}
