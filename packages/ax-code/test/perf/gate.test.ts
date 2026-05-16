import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"

import type { Bench } from "../../src/cli/cmd/debug/perf"
import {
  baselineSummary,
  compare,
  evaluate,
  guard,
  load,
  meta,
  read,
  regression,
  render,
  renderCompare,
  resolve,
  threshold,
  verdict,
} from "../../script/perf-index"

const report: Bench = {
  projectID: "p1",
  directory: "/repo",
  worktree: "/repo",
  requested: {
    cacheMode: "cold",
    concurrency: 4,
    repeat: 3,
    warmup: 1,
    probe: false,
    nativeProfile: false,
  },
  files: 10,
  samples: [],
  summary: {
    elapsedMs: { min: 100, max: 200, mean: 150, median: 140 },
    totalMs: { min: 50, max: 90, mean: 70, median: 60 },
    diagnosis: ["Cold start dominates: client initialize 250ms, touch.select.spawned 375ms."],
    phases: {
      "lsp.touch": { min: 10, max: 20, mean: 15, median: 14 },
      "lsp.references": { min: 20, max: 40, mean: 30, median: 28 },
    },
  },
}

describe("perf.gate", () => {
  test("evaluates passing thresholds", () => {
    const result = evaluate(report, {
      elapsedMs: 200,
      totalMs: 100,
      phases: {
        "lsp.touch": 20,
      },
    })

    expect(result.failures).toEqual([])
    expect(result.notes).toContain("- elapsed median: 140.00ms (limit 200.00ms)")
  })

  test("reports threshold failures", () => {
    const result = evaluate(report, {
      elapsedMs: 120,
      totalMs: 100,
      phases: {
        "lsp.references": 10,
        "missing.phase": 10,
      },
    })

    expect(result.failures).toEqual([
      "elapsed median 140.00ms exceeds 120.00ms",
      "phase lsp.references median 28.00ms exceeds 10.00ms",
      "phase missing.phase not found in benchmark summary",
    ])
  })

  test("renders markdown summary", () => {
    const text = render(
      report,
      {
        failures: ["elapsed median 140.00ms exceeds 120.00ms"],
        notes: ["- elapsed median: 140.00ms (limit 120.00ms)"],
      },
      "/tmp/perf-index.json",
      "/tmp/perf-index-summary.json",
      "/tmp/perf-index-baseline.json",
    )

    expect(text).toContain("## ax-code perf index")
    expect(text).toContain("Artifact: /tmp/perf-index.json")
    expect(text).toContain("Summary: /tmp/perf-index-summary.json")
    expect(text).toContain("Baseline out: /tmp/perf-index-baseline.json")
    expect(text).toContain("Diagnosis:")
    expect(text).toContain("Cold start dominates: client initialize 250ms, touch.select.spawned 375ms.")
    expect(text).toContain("Failures:")
  })

  test("parses threshold args from argv", () => {
    const prev = process.argv
    process.argv = [
      "bun",
      "script/perf-index.ts",
      "--max-elapsed-median-ms",
      "123",
      "--max-total-median-ms",
      "45",
      "--max-phase-median-ms",
      "lsp.touch=12",
      "--max-phase-median-ms",
      "db.transaction=8",
    ]

    expect(threshold()).toEqual({
      elapsedMs: 123,
      totalMs: 45,
      phases: {
        "lsp.touch": 12,
        "db.transaction": 8,
      },
    })

    process.argv = prev
  })

  test("parses regression args from argv", () => {
    const prev = process.argv
    process.argv = [
      "bun",
      "script/perf-index.ts",
      "--max-elapsed-regression-pct",
      "15",
      "--max-total-regression-pct",
      "10",
      "--max-phase-regression-pct",
      "lsp.touch=5",
    ]

    expect(regression()).toEqual({
      elapsedPct: 15,
      totalPct: 10,
      phases: {
        "lsp.touch": 5,
      },
    })

    process.argv = prev
  })

  test("resolves explicit boolean cli overrides over config", () => {
    const prev = process.argv
    process.argv = ["bun", "script/perf-index.ts", "--probe=false", "--no-native-profile"]

    expect(resolve("/repo", undefined, { bench: { probe: true, nativeProfile: true } })).toMatchObject({
      probe: false,
      nativeProfile: false,
    })

    process.argv = prev
  })

  test("parses boolean values passed as separate argv items", () => {
    const prev = process.argv
    process.argv = ["bun", "script/perf-index.ts", "--probe", "true", "--native-profile", "false"]

    expect(resolve("/repo", undefined, {})).toMatchObject({
      probe: true,
      nativeProfile: false,
    })

    process.argv = prev
  })

  test("resolves summary and baseline write paths", () => {
    const prev = process.argv
    process.argv = [
      "bun",
      "script/perf-index.ts",
      "--summary-out",
      ".tmp/custom-summary.json",
      "--write-baseline",
      ".tmp/base-next.json",
    ]

    expect(resolve("/repo", "/repo/perf-index.jsonc", { summary: ".tmp/default-summary.json" })).toMatchObject({
      summary: "/repo/.tmp/custom-summary.json",
      baseline: {
        out: "/repo/.tmp/base-next.json",
        outSummary: "/repo/.tmp/base-next-summary.json",
      },
    })

    process.argv = prev
  })

  test("compares against baseline regressions", () => {
    const prev: Bench = {
      ...report,
      summary: {
        ...report.summary,
        elapsedMs: { min: 80, max: 120, mean: 100, median: 100 },
        totalMs: { min: 40, max: 60, mean: 50, median: 50 },
        phases: {
          "lsp.touch": { min: 10, max: 12, mean: 11, median: 11 },
          "lsp.references": { min: 10, max: 15, mean: 12, median: 12 },
          "db.transaction": { min: 10, max: 10, mean: 10, median: 10 },
        },
      },
    }

    const curr: Bench = {
      ...report,
      summary: {
        ...report.summary,
        phases: {
          ...report.summary.phases,
          "db.transaction": { min: 3, max: 4, mean: 3.5, median: 4 },
        },
      },
    }

    const result = compare(curr, prev, {
      elapsedPct: 20,
      totalPct: 30,
      phases: {
        "lsp.references": 50,
      },
    })

    expect(result.failures).toEqual([
      "elapsed median regression 140.00ms vs 100.00ms exceeds 20.0%",
      "phase lsp.references regression 133.3% exceeds 50.0%",
    ])
    expect(result.phases.regressions.map((item) => item.name)).toEqual(["lsp.references", "lsp.touch"])
    expect(result.phases.improvements.map((item) => item.name)).toEqual(["db.transaction"])
    expect(result.phases.stable).toBe(0)
  })

  test("renders baseline comparison summary", () => {
    const text = renderCompare(
      report,
      {
        failures: ["phase lsp.touch regression 25.0% exceeds 10.0%"],
        notes: ["- lsp.touch median: 14.00ms vs 11.00ms (27.3%, limit 10.0%)"],
        compat: {
          failures: ["baseline config /old.jsonc does not match current config /new.jsonc"],
          notes: ["- baseline created at: 2026-04-10T18:00:00.000Z"],
        },
        phases: {
          regressions: [
            { name: "lsp.touch", currMs: 14, prevMs: 11, diffMs: 3, diffPct: 27.2727 },
            { name: "lsp.references", currMs: 28, prevMs: 26, diffMs: 2, diffPct: 7.6923 },
          ],
          improvements: [{ name: "db.transaction", currMs: 3, prevMs: 5, diffMs: -2, diffPct: -40 }],
          stable: 1,
          missing: ["symbol.walk"],
        },
      },
      "/tmp/current.json",
      "/tmp/base.json",
    )

    expect(text).toContain("## ax-code perf index baseline")
    expect(text).toContain("current: /tmp/current.json")
    expect(text).toContain("baseline: /tmp/base.json")
    expect(text).toContain("Top regressions:")
    expect(text).toContain("Top improvements:")
    expect(text).toContain("- stable phases: 1")
    expect(text).toContain("Compatibility:")
    expect(text).toContain("Compatibility Failures:")
  })

  test("builds machine-readable verdict", () => {
    const out = verdict(
      report,
      "/tmp/perf-index.json",
      "/tmp/perf-index-summary.json",
      {
        failures: [],
        notes: ["- elapsed median: 140.00ms"],
      },
      {
        failures: ["phase lsp.touch regression 27.3% exceeds 10.0%"],
        notes: ["- lsp.touch median: 14.00ms vs 11.00ms (27.3%, limit 10.0%)"],
        compat: {
          failures: ["baseline config /old.jsonc does not match current config /repo/perf-index.jsonc"],
          notes: ["- baseline created at: 2026-04-10T17:00:00.000Z"],
        },
        phases: {
          regressions: [{ name: "lsp.touch", currMs: 14, prevMs: 11, diffMs: 3, diffPct: 27.2727 }],
          improvements: [],
          stable: 0,
          missing: [],
        },
      },
      "/tmp/base.json",
      "/tmp/base-summary.json",
      "/tmp/base-next.json",
      "/tmp/base-next-summary.json",
      {
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
    )

    expect(out).toEqual({
      ok: false,
      directory: "/repo",
      files: 10,
      out: "/tmp/perf-index.json",
      summary: "/tmp/perf-index-summary.json",
      baseline: {
        file: "/tmp/base.json",
        summary: "/tmp/base-summary.json",
        out: "/tmp/base-next.json",
        outSummary: "/tmp/base-next-summary.json",
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
        },
      },
      gate: {
        ok: true,
        failures: [],
        notes: ["- elapsed median: 140.00ms"],
      },
      compare: {
        ok: false,
        failures: ["phase lsp.touch regression 27.3% exceeds 10.0%"],
        notes: ["- lsp.touch median: 14.00ms vs 11.00ms (27.3%, limit 10.0%)"],
        compat: {
          failures: ["baseline config /old.jsonc does not match current config /repo/perf-index.jsonc"],
          notes: ["- baseline created at: 2026-04-10T17:00:00.000Z"],
        },
        phases: {
          regressions: [{ name: "lsp.touch", currMs: 14, prevMs: 11, diffMs: 3, diffPct: 27.2727 }],
          improvements: [],
          stable: 0,
          missing: [],
        },
      },
    })
  })

  test("collects provenance metadata", async () => {
    const out = await meta("/Users/akiralam/code/ax-code/packages/ax-code", "/repo/perf-index.jsonc")

    expect(out).toMatchObject({
      config: "/repo/perf-index.jsonc",
      argv: expect.any(Array),
      runtime: {
        platform: expect.any(String),
        arch: expect.any(String),
      },
      host: {
        hostname: expect.any(String),
      },
      git: expect.any(Object),
      ci: expect.any(Object),
    })
    expect(typeof out.createdAt).toBe("string")
  })

  test("loads optional baseline summary sidecar", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-perf-"))
    const file = path.join(dir, "base-summary.json")
    await Bun.write(
      file,
      JSON.stringify({
        ok: true,
        directory: "/repo",
        files: 1,
        out: "/tmp/base.json",
        summary: file,
        baseline: {},
        meta: {
          createdAt: "2026-04-10T18:00:00.000Z",
          argv: [],
          runtime: { platform: "darwin", arch: "arm64" },
          host: { hostname: "host" },
          git: {},
          ci: {},
        },
        requested: report.requested,
        metrics: { elapsedMs: 1, totalMs: 1, phases: {} },
        gate: { ok: true, failures: [], notes: [] },
      }) + "\n",
    )

    const out = await baselineSummary(file)
    expect(out.file).toBe(file)
    expect(out.verdict?.summary).toBe(file)
  })

  test("guards incompatible baseline provenance", () => {
    const out = guard(
      {
        directory: "/repo",
        meta: {
          createdAt: "2026-04-10T18:00:00.000Z",
          config: "/repo/perf-index.jsonc",
          argv: [],
          runtime: { bun: "1.3.11", platform: "darwin", arch: "arm64" },
          host: { hostname: "host" },
          git: { branch: "feature" },
          ci: {},
        },
        requested: report.requested,
      },
      {
        ok: true,
        directory: "/other",
        files: 1,
        out: "/tmp/base.json",
        summary: "/tmp/base-summary.json",
        baseline: {},
        meta: {
          createdAt: "2026-04-10T17:00:00.000Z",
          config: "/repo/old.jsonc",
          argv: [],
          runtime: { bun: "1.3.10", platform: "linux", arch: "x64" },
          host: { hostname: "host" },
          git: { branch: "main" },
          ci: {},
        },
        requested: report.requested,
        metrics: { elapsedMs: 1, totalMs: 1, phases: {} },
        gate: { ok: true, failures: [], notes: [] },
      },
    )

    expect(out.failures).toEqual([
      "baseline directory /other does not match current directory /repo",
      "baseline config /repo/old.jsonc does not match current config /repo/perf-index.jsonc",
      "baseline runtime linux/x64 does not match current runtime darwin/arm64",
    ])
    expect(out.notes).toContain("- baseline created at: 2026-04-10T17:00:00.000Z")
    expect(out.notes).toContain("- bun version differs: 1.3.11 vs 1.3.10")
    expect(out.notes).toContain("- git branch differs: feature vs main")
  })

  test("loads jsonc config file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-perf-"))
    const file = path.join(dir, "perf-index.jsonc")
    await Bun.write(
      file,
      `{
        "bench": { "limit": 12, "repeat": 4, "nativeProfile": true },
        "gate": { "elapsedMs": 500, "phases": { "lsp.touch": 100 } },
        "baseline": { "file": ".tmp/base.json", "summary": ".tmp/base-summary.json", "elapsedPct": 20 },
        "summary": ".tmp/summary.json",
        "out": ".tmp/out.json"
      }`,
    )

    expect(await load(file)).toEqual({
      bench: {
        limit: 12,
        repeat: 4,
        warmup: undefined,
        concurrency: undefined,
        probe: undefined,
        nativeProfile: true,
      },
      gate: {
        elapsedMs: 500,
        totalMs: undefined,
        phases: {
          "lsp.touch": 100,
        },
      },
      baseline: {
        file: ".tmp/base.json",
        summary: ".tmp/base-summary.json",
        elapsedPct: 20,
        totalPct: undefined,
        phases: {},
      },
      summary: ".tmp/summary.json",
      out: ".tmp/out.json",
    })
  })

  test("reads default config from cwd", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-perf-"))
    await Bun.write(path.join(dir, "perf-index.jsonc"), `{"bench":{"repeat":2}}`)

    const prev = process.argv
    process.argv = ["bun", "script/perf-index.ts"]
    await expect(read(dir)).resolves.toMatchObject({
      file: path.join(dir, "perf-index.jsonc"),
      cfg: {
        bench: {
          repeat: 2,
        },
      },
    })
    process.argv = prev
  })
})
