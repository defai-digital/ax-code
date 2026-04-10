import { describe, expect, test } from "bun:test"

import type { Bench } from "../../src/cli/cmd/debug/perf"
import type { Verdict } from "../../script/perf-index"
import { render } from "../../script/perf-report"

const report: Bench = {
  projectID: "p1",
  directory: "/repo",
  worktree: "/repo",
  requested: {
    concurrency: 4,
    repeat: 3,
    warmup: 1,
    probe: false,
    nativeProfile: true,
  },
  files: 10,
  samples: [],
  summary: {
    elapsedMs: { min: 100, max: 200, mean: 150, median: 140 },
    totalMs: { min: 50, max: 90, mean: 70, median: 60 },
    phases: {
      "lsp.touch": { min: 10, max: 20, mean: 15, median: 14 },
      "lsp.references": { min: 20, max: 40, mean: 30, median: 28 },
      "db.transaction": { min: 1, max: 4, mean: 2, median: 3 },
    },
  },
}

const verdict: Verdict = {
  ok: false,
  directory: "/repo",
  files: 10,
  out: "/tmp/perf-index.json",
  summary: "/tmp/perf-index-summary.json",
  baseline: {
    file: "/tmp/perf-index-baseline.json",
    summary: "/tmp/perf-index-baseline-summary.json",
    out: "/tmp/perf-index-baseline-next.json",
    outSummary: "/tmp/perf-index-baseline-next-summary.json",
    compat: {
      ok: false,
      failures: ["baseline config /old.jsonc does not match current config /repo/perf-index.jsonc"],
      notes: ["- baseline created at: 2026-04-10T17:00:00.000Z"],
    },
  },
  meta: {
    createdAt: "2026-04-10T18:00:00.000Z",
    config: "/repo/perf-index.jsonc",
    argv: ["--config", "perf-index.jsonc"],
    runtime: {
      bun: "1.3.11",
      platform: "darwin",
      arch: "arm64",
    },
    host: {
      hostname: "host",
    },
    git: {
      branch: "main",
      commit: "abc123",
    },
    ci: {
      githubWorkflow: "ax-code-perf",
      githubRunId: "123",
      githubSha: "abc123",
      githubRef: "refs/heads/main",
    },
  },
  requested: report.requested,
  metrics: {
    elapsedMs: 140,
    totalMs: 60,
    phases: {
      "lsp.touch": 14,
      "lsp.references": 28,
      "db.transaction": 3,
    },
  },
  gate: {
    ok: true,
    failures: [],
    notes: ["- elapsed median: 140.00ms", "- builder total median: 60.00ms"],
  },
  compare: {
    ok: false,
    failures: ["phase lsp.references regression 133.3% exceeds 50.0%"],
    notes: ["- lsp.references median: 28.00ms vs 12.00ms (133.3%, limit 50.0%)"],
    phases: {
      regressions: [{ name: "lsp.references", currMs: 28, prevMs: 12, diffMs: 16, diffPct: 133.3333 }],
      improvements: [{ name: "db.transaction", currMs: 3, prevMs: 5, diffMs: -2, diffPct: -40 }],
      stable: 1,
      missing: ["symbol.walk"],
    },
  },
}

describe("perf.report", () => {
  test("renders markdown report", () => {
    const text = render(verdict, report)

    expect(text).toContain("## ax-code perf report")
    expect(text).toContain("- status: failed")
    expect(text).toContain("- report: /tmp/perf-index.json")
    expect(text).toContain("- summary: /tmp/perf-index-summary.json")
    expect(text).toContain("- baseline summary: /tmp/perf-index-baseline-summary.json")
    expect(text).toContain("- promoted baseline: /tmp/perf-index-baseline-next.json")
    expect(text).toContain("- promoted baseline summary: /tmp/perf-index-baseline-next-summary.json")
    expect(text).toContain("Provenance:")
    expect(text).toContain("- git branch: main")
    expect(text).toContain("- git commit: abc123")
    expect(text).toContain("Baseline Comparison:")
    expect(text).toContain("Compatibility:")
    expect(text).toContain("Compatibility Failures:")
    expect(text).toContain("Top regressions:")
    expect(text).toContain("Top improvements:")
    expect(text).toContain("- stable phases: 1")
    expect(text).toContain("- lsp.references: 28.00ms vs 12.00ms (+16.00ms, +133.3%)")
  })
})
