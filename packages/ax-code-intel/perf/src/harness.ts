// Perf baseline harness for @ax-code/ax-code-intel (PRD Phase 0).
//
//   pnpm run perf:intel          # all scenarios, smoke profile, synthetic fixtures
//   pnpm run perf:intel:smoke    # same as above (explicit)
//   pnpm run perf:intel:full     # full profile + --record
//   tsx packages/ax-code-intel/perf/src/harness.ts --scenario cold-start
//   tsx ... --external --record  # include pinned external fixtures
//   tsx ... --compare perf/baseline/baseline.reference.json [--fail-on-regression]
//
// Manual-only by design: not wired into CI, test:scripts, or Turbo. See
// perf/README.md for interpretation and baseline-refresh policy.
import { execFile } from "node:child_process"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import which from "which"
import { LSPServer } from "../../src/server"
import { configurePerfHost } from "./host"
import type { FixtureDescriptor } from "./fixtures"
import {
  baselineDir,
  loadExternalFixtures,
  loadSyntheticFixtures,
  cloneExternalFixture,
  materializeFixture,
} from "./fixtures"
import type { ScenarioResult } from "./metrics"
import {
  buildBaseline,
  collectMeta,
  compareResults,
  formatComparisonMarkdown,
  formatMarkdownTable,
  readBaseline,
  writeBaseline,
} from "./report"
import type { ScenarioContext, ScenarioName } from "./scenarios"
import { FULL_PROFILE, SCENARIO_NAMES, SMOKE_PROFILE, runAllScenarios, runScenario } from "./scenarios"

const execFileAsync = promisify(execFile)

type Cli = {
  scenario: "smoke" | "full" | ScenarioName
  external: boolean
  record: boolean
  compare?: string
  failOnRegression: boolean
  thresholdPct: number
  queryTimeoutMs: number
  coldStartTimeoutMs: number
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    scenario: "smoke",
    external: false,
    record: false,
    failOnRegression: false,
    thresholdPct: 20,
    queryTimeoutMs: 5_000,
    coldStartTimeoutMs: 60_000,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--scenario": {
        const value = argv[++i]
        if (value !== "smoke" && value !== "full" && !SCENARIO_NAMES.includes(value as ScenarioName)) {
          throw new Error(
            `unknown --scenario "${value}" (expected smoke, full, or one of ${SCENARIO_NAMES.join(", ")})`,
          )
        }
        cli.scenario = value as Cli["scenario"]
        break
      }
      case "--external":
        cli.external = true
        break
      case "--record":
        cli.record = true
        break
      case "--compare":
        cli.compare = argv[++i]
        if (!cli.compare) throw new Error("--compare requires a baseline file path")
        break
      case "--fail-on-regression":
        cli.failOnRegression = true
        break
      case "--threshold":
        cli.thresholdPct = Number(argv[++i])
        if (!Number.isFinite(cli.thresholdPct) || cli.thresholdPct <= 0) {
          throw new Error("--threshold must be a positive number (percent)")
        }
        break
      case "--timeout":
        cli.queryTimeoutMs = Number(argv[++i])
        if (!Number.isFinite(cli.queryTimeoutMs) || cli.queryTimeoutMs <= 0) {
          throw new Error("--timeout must be a positive number (ms)")
        }
        break
      case "--cold-timeout":
        cli.coldStartTimeoutMs = Number(argv[++i])
        if (!Number.isFinite(cli.coldStartTimeoutMs) || cli.coldStartTimeoutMs <= 0) {
          throw new Error("--cold-timeout must be a positive number (ms)")
        }
        break
      default:
        throw new Error(`unknown argument "${arg}"`)
    }
  }
  return cli
}

// The harness measures these three servers — the three languages the PRD
// scopes Phase 0 to. Keyed by the serverId recorded in the fixture manifest.
const SERVER_DEFS: Record<string, { server: LSPServer.Info; language: "ts" | "py" | "rust"; binary: string }> = {
  typescript: { server: LSPServer.Typescript, language: "ts", binary: "typescript-language-server" },
  pyright: { server: LSPServer.Pyright, language: "py", binary: "pyright-langserver" },
  rust: { server: LSPServer.RustAnalyzer, language: "rust", binary: "rust-analyzer" },
}

// Preflight: resolve each server binary on PATH *and* probe it with
// `--version` — a binary that resolves but cannot run (e.g. a rustup proxy
// whose toolchain lacks the rust-analyzer component) would otherwise hang or
// crash mid-scenario. Missing/broken servers skip their fixture with a clear
// line; a machine with zero working servers is a hard error.
async function preflight(fixtures: FixtureDescriptor[]): Promise<Map<string, string>> {
  console.log("LSP server preflight:")
  const available = new Map<string, string>()
  const seen = new Set<string>()
  for (const fixture of fixtures) {
    if (seen.has(fixture.serverId)) continue
    seen.add(fixture.serverId)
    const def = SERVER_DEFS[fixture.serverId]
    if (!def) {
      console.log(`  ${fixture.language.padEnd(6)} ${fixture.serverId}: no harness server mapping (skipping)`)
      continue
    }
    const label = `${def.language.padEnd(6)} ${def.binary.padEnd(26)}`
    const resolved = which.sync(def.binary, { nothrow: true })
    if (!resolved) {
      console.log(`  ${label} MISSING — skipping ${fixture.id}`)
      continue
    }
    try {
      const { stdout } = await execFileAsync(resolved, ["--version"], { timeout: 10_000 })
      const version = stdout.trim().split("\n")[0] ?? "unknown version"
      console.log(`  ${label} ${resolved} (${version})`)
      available.set(fixture.serverId, resolved)
    } catch (err) {
      const stderr = (err as { stderr?: string } | undefined)?.stderr?.trim().split("\n")[0]
      console.log(
        `  ${label} BROKEN (${resolved} failed --version${stderr ? `: ${stderr}` : ""}) — skipping ${fixture.id}`,
      )
    }
  }
  return available
}

// External fixtures have no manifest: build a descriptor from a directory
// walk (files feed the graph-builder scenario) with no query points — the
// query-driven scenarios require pinned points and are skipped.
async function externalDescriptor(
  fixture: { id: string; language: "ts" | "py" | "rust"; serverId: string; serverBinary: string },
  dir: string,
): Promise<FixtureDescriptor> {
  const files: Record<string, string> = {}
  const walk = async (sub: string): Promise<void> => {
    const entries = await readdir(path.join(dir, sub), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const rel = sub ? `${sub}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if ([".git", "node_modules", "target", "dist"].includes(entry.name)) continue
        await walk(rel)
      } else if (entry.isFile()) {
        files[rel] = ""
      }
    }
  }
  await walk("")
  return {
    id: fixture.id,
    language: fixture.language,
    serverId: fixture.serverId,
    serverBinary: fixture.serverBinary,
    diagnosticFile: "",
    files,
    queries: { hover: [], definition: [], references: [] },
  }
}

async function main() {
  const cli = parseArgs(process.argv.slice(2))
  // The intel package logs to stderr by default; keep harness output readable.
  process.env.AX_CODEINTEL_LOG_LEVEL ??= "ERROR"

  const synthetic = await loadSyntheticFixtures()
  const fixtures: {
    descriptor: FixtureDescriptor
    materialized?: { workDir: string; cleanup: () => Promise<void> }
  }[] = []
  for (const descriptor of synthetic) {
    fixtures.push({ descriptor })
  }
  let externalTmp: string | undefined
  if (cli.external) {
    externalTmp = await mkdtemp(path.join(os.tmpdir(), "ax-code-perf-external-"))
    for (const fixture of await loadExternalFixtures()) {
      const dir = await cloneExternalFixture(fixture, externalTmp)
      const descriptor = await externalDescriptor(fixture, dir)
      fixtures.push({ descriptor, materialized: { workDir: dir, cleanup: async () => {} } })
    }
  }

  const available = await preflight(fixtures.map((f) => f.descriptor))
  const runnable = fixtures.filter((f) => available.has(f.descriptor.serverId))
  if (runnable.length === 0) {
    console.error(
      "\nno LSP servers available — install at least one of: " +
        Object.values(SERVER_DEFS)
          .map((def) => def.binary)
          .join(", "),
    )
    process.exit(1)
  }

  const profile = cli.scenario === "full" ? FULL_PROFILE : SMOKE_PROFILE
  const results: ScenarioResult[] = []
  let hadErrors = false

  for (const entry of runnable) {
    const { descriptor } = entry
    const def = SERVER_DEFS[descriptor.serverId]!
    console.log(`\n▸ ${descriptor.id} (${descriptor.language}, server ${descriptor.serverId})`)
    const materialized = entry.materialized ?? (await materializeFixture(descriptor))
    try {
      configurePerfHost(materialized.workDir)
      const ctx: ScenarioContext = {
        fixture: descriptor,
        workDir: materialized.workDir,
        server: def.server,
        profile,
        queryTimeoutMs: cli.queryTimeoutMs,
        coldStartTimeoutMs: cli.coldStartTimeoutMs,
      }
      const hasQueryPoints = descriptor.queries.references.length > 0
      const report = (name: string, rows: ScenarioResult[], started: number) => {
        results.push(...rows)
        for (const row of rows) {
          console.log(
            `  ${row.scenario.padEnd(24)} p50=${row.p50}ms p95=${row.p95}ms samples=${row.samples}` +
              (row.peakRssKb !== undefined ? ` peakRss=${Math.round(row.peakRssKb / 1024)}MB` : "") +
              (row.hitRate !== undefined ? ` hitRate=${row.hitRate}` : "") +
              (row.rpcCount !== undefined ? ` rpc=${row.rpcCount}` : "") +
              ` (${Math.round(performance.now() - started)}ms)`,
          )
        }
        if (rows.length === 0) console.log(`  ${name}: no result (server spawn returned nothing)`)
      }
      const started = performance.now()
      if (cli.scenario === "smoke" || cli.scenario === "full") {
        if (hasQueryPoints) {
          report("all", await runAllScenarios(ctx), started)
        } else {
          // External fixtures have no pinned query points: cold-start +
          // graph-builder only.
          report("cold-start", await runScenario("cold-start", ctx), started)
          report("graph-builder", await runScenario("graph-builder", ctx), started)
        }
      } else {
        if (!hasQueryPoints && !["cold-start", "graph-builder"].includes(cli.scenario)) {
          console.log(`  skipping ${cli.scenario}: fixture has no pinned query points`)
        } else {
          report(cli.scenario, await runScenario(cli.scenario, ctx), started)
        }
      }
    } catch (err) {
      hadErrors = true
      console.error(`  scenario failed for ${descriptor.id}:`, err instanceof Error ? err.message : err)
    } finally {
      await materialized.cleanup()
    }
  }
  if (externalTmp) await rm(externalTmp, { recursive: true, force: true })

  console.log(`\n${formatMarkdownTable(results)}\n`)

  if (cli.record) {
    const file = await writeBaseline(baselineDir(), buildBaseline(results, collectMeta(cli.scenario, cli.external)))
    console.log(`recorded baseline: ${path.relative(process.cwd(), file)}`)
  }

  if (cli.compare) {
    const reference = await readBaseline(cli.compare)
    const rows = compareResults(results, reference.results, cli.thresholdPct)
    console.log(formatComparisonMarkdown(rows))
    const regressions = rows.filter((row) => row.regression)
    if (regressions.length > 0) {
      console.log(`\n${regressions.length} metric(s) degraded beyond ${cli.thresholdPct}%`)
      if (cli.failOnRegression) process.exit(1)
    } else {
      console.log(`\nno regressions beyond ${cli.thresholdPct}% vs ${path.basename(cli.compare)}`)
    }
  }

  if (hadErrors) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
