import path from "path"
import type { Snapshot } from "../snapshot"

export namespace SessionSemanticCore {
  export const kindList = [
    "bug_fix",
    "refactor",
    "optimization",
    "test",
    "documentation",
    "configuration",
    "dependency",
    "rewrite",
  ] as const
  export type Kind = (typeof kindList)[number]

  export const riskList = ["low", "medium", "high"] as const
  export type Risk = (typeof riskList)[number]

  export type Count = {
    kind: Kind
    count: number
  }

  export type Change = {
    file: string
    status: Snapshot.FileDiff["status"] | null
    kind: Kind
    risk: Risk
    summary: string
    additions: number
    deletions: number
    signals: string[]
  }

  export type Summary = {
    headline: string
    risk: Risk
    primary: Kind
    files: number
    additions: number
    deletions: number
    counts: Count[]
    signals: string[]
    changes: Change[]
  }

  const docs = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"])
  const cfg = new Set([".json", ".jsonc", ".toml", ".yaml", ".yml", ".ini", ".conf"])
  const dep = new Set([
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "bun.lock",
    "bun.lockb",
    "package-lock.json",
    "yarn.lock",
    "turbo.json",
  ])
  const code = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".go",
    ".rs",
    ".py",
    ".java",
    ".kt",
    ".swift",
    ".c",
    ".cc",
    ".cpp",
    ".h",
    ".hpp",
  ])
  const guard = ["if (", "if(", "?.", "??", "throw ", "assert", "guard", "validate", "null", "undefined"]
  const fast = ["cache", "memo", "memoize", "promise.all", "parallel", "batch", "optimi", "map(", "set("]
  const helper = ["function ", "export function ", "class ", "switch ("]

  function count(text: string, pats: string[]) {
    const low = text.toLowerCase()
    return pats.reduce((sum, pat) => sum + low.split(pat).length - 1, 0)
  }

  function delta(before: string, after: string, pats: string[]) {
    return count(after, pats) - count(before, pats)
  }

  function lines(text: string) {
    if (!text.trim()) return 0
    return text.trimEnd().split("\n").length
  }

  function name(file: string) {
    return path.basename(file)
  }

  function label(kind: Kind) {
    switch (kind) {
      case "bug_fix":
        return "bug fix"
      case "refactor":
        return "refactor"
      case "optimization":
        return "optimization"
      case "test":
        return "test coverage"
      case "documentation":
        return "documentation"
      case "configuration":
        return "configuration"
      case "dependency":
        return "dependency update"
      case "rewrite":
        return "rewrite"
    }
  }

  function weight(kind: Kind) {
    switch (kind) {
      case "rewrite":
        return 8
      case "bug_fix":
        return 7
      case "optimization":
        return 6
      case "refactor":
        return 5
      case "dependency":
        return 4
      case "configuration":
        return 3
      case "test":
        return 2
      case "documentation":
        return 1
    }
  }

  function severity(risk: Risk) {
    switch (risk) {
      case "high":
        return 3
      case "medium":
        return 2
      case "low":
        return 1
    }
  }

  export function format(kind: Kind) {
    return label(kind)
  }

  export function classify(diff: Snapshot.FileDiff): Kind {
    const file = diff.file.toLowerCase()
    const ext = path.extname(file)
    const churn = diff.additions + diff.deletions
    const before = lines(diff.before)
    const after = lines(diff.after)
    const ratio = after / Math.max(before, 1)
    const guards = delta(diff.before, diff.after, guard)
    const faster = delta(diff.before, diff.after, fast)
    const helpers = delta(diff.before, diff.after, helper)

    if (file.includes("/__tests__/") || file.includes("/test/") || file.includes("/tests/") || file.includes(".test.") || file.includes(".spec."))
      return "test"
    if (docs.has(ext)) return "documentation"
    if (dep.has(name(file))) return "dependency"
    if (cfg.has(ext) || file.includes(".env") || name(file).startsWith("tsconfig") || name(file) === "bunfig.toml")
      return "configuration"
    if (diff.status === "deleted") return "rewrite"
    if (code.has(ext) && (churn >= 180 || (Math.max(before, after) >= 80 && (ratio >= 2.5 || ratio <= 0.4)))) return "rewrite"
    if (faster > 0 && churn <= 120) return "optimization"
    if (guards > 0 && churn <= 100) return "bug_fix"
    if (helpers > 0 || code.has(ext)) return "refactor"
    return churn >= 120 ? "rewrite" : "configuration"
  }

  export function assess(diff: Snapshot.FileDiff, kind: Kind): Risk {
    const file = diff.file.toLowerCase()
    const churn = diff.additions + diff.deletions
    const hot =
      file.includes("/server/") ||
      file.includes("/routes/") ||
      file.includes("/auth/") ||
      file.includes("/security/") ||
      file.includes("/session/")

    if (kind === "documentation" || kind === "test") return churn >= 120 ? "medium" : "low"
    if (kind === "configuration") return churn >= 40 || hot ? "medium" : "low"
    if (kind === "dependency") return churn >= 80 ? "high" : "medium"
    if (kind === "rewrite" || diff.status === "deleted") return hot || churn >= 80 ? "high" : "medium"
    if (hot || churn >= 80) return "medium"
    return "low"
  }

  function signals(diff: Snapshot.FileDiff, kind: Kind) {
    const file = diff.file.toLowerCase()
    const churn = diff.additions + diff.deletions
    const out = [`${churn} lines touched`] as string[]
    if (diff.status === "added") out.push("new file")
    if (diff.status === "deleted") out.push("file removed")
    if (kind === "bug_fix") out.push("guard or validation logic added")
    if (kind === "optimization") out.push("performance-oriented change")
    if (kind === "rewrite") out.push("large structural churn")
    if (file.includes("/server/") || file.includes("/routes/")) out.push("runtime path affected")
    return [...new Set(out)].slice(0, 3)
  }

  export function change(diff: Snapshot.FileDiff): Change {
    const kind = classify(diff)
    const risk = assess(diff, kind)
    return {
      file: diff.file,
      status: diff.status ?? null,
      kind,
      risk,
      summary: `${label(kind)} · ${name(diff.file)}`,
      additions: diff.additions,
      deletions: diff.deletions,
      signals: signals(diff, kind),
    }
  }

  export function summarize(diff: Snapshot.FileDiff[]) {
    if (diff.length === 0) return

    const changes = diff
      .map(change)
      .sort(
        (a, b) =>
          severity(b.risk) - severity(a.risk) ||
          b.additions + b.deletions - (a.additions + a.deletions) ||
          a.file.localeCompare(b.file),
      )
    const counts = Object.entries(
      changes.reduce(
        (out, item) => {
          out[item.kind] = (out[item.kind] ?? 0) + 1
          return out
        },
        {} as Record<Kind, number>,
      ),
    )
      .map(([kind, count]) => ({ kind: kind as Kind, count }))
      .sort((a, b) => b.count - a.count || weight(b.kind) - weight(a.kind))
    const primary = changes[0]!.kind
    const risk = changes.reduce<Risk>((out, item) => {
      if (severity(item.risk) > severity(out)) return item.risk
      return out
    }, "low")
    const files = diff.length
    const additions = diff.reduce((sum, item) => sum + item.additions, 0)
    const deletions = diff.reduce((sum, item) => sum + item.deletions, 0)
    const headline =
      files === 1 ? `${label(primary)} · ${name(changes[0]!.file)}` : `${label(primary)} across ${files} files`

    return {
      headline,
      risk,
      primary,
      files,
      additions,
      deletions,
      counts,
      signals: [...new Set(changes.flatMap((item) => item.signals))].slice(0, 4),
      changes,
    } satisfies Summary
  }
}
