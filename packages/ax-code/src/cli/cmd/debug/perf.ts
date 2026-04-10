import { EOL } from "os"
import path from "path"
import type { Argv } from "yargs"
import { CodeIntelligence } from "../../../code-intelligence"
import { Instance } from "../../../project/instance"
import { Ripgrep } from "../../../file/ripgrep"
import { NativePerf } from "../../../perf/native"
import { buildIndexReport, groupFilesByLanguage, isIndexableFile, probeLspServers } from "../index-graph"
import { cmd } from "../cmd"

export type IndexReport = ReturnType<typeof buildIndexReport>

type Stat = {
  min: number
  max: number
  mean: number
  median: number
}

export type Summary = {
  elapsedMs: Stat
  totalMs: Stat
  phases: Record<string, Stat>
  native?: {
    total: Record<"calls" | "fails" | "totalMs" | "inBytes" | "outBytes", Stat>
    rows: Record<string, Record<"calls" | "fails" | "totalMs" | "inBytes" | "outBytes", Stat>>
  }
}

type Native = NonNullable<Summary["native"]>

export type Bench = {
  projectID: string
  directory: string
  worktree: string
  requested: {
    concurrency: number
    limit?: number
    probe: boolean
    repeat: number
    warmup: number
    nativeProfile: boolean
  }
  files: number
  probeResult?: {
    ready: string[]
    missing: Record<string, number>
  }
  samples: IndexReport[]
  summary: Summary
}

function int(value: unknown, key: string, min = 0) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new Error(`${key} must be an integer >= ${min}`)
  }
  return value
}

export function stat(vals: number[]): Stat {
  if (vals.length === 0) return { min: 0, max: 0, mean: 0, median: 0 }

  const sorted = [...vals].sort((a, b) => a - b)
  const half = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[half - 1]! + sorted[half]!) / 2 : sorted[half]!

  return {
    min: sorted[0]!,
    max: sorted.at(-1)!,
    mean: vals.reduce((sum, item) => sum + item, 0) / vals.length,
    median,
  }
}

export function summarize(samples: IndexReport[]): Summary {
  const phases = new Map<string, number[]>()
  const total = new Map<string, number[]>()
  const rows = new Map<string, Map<string, number[]>>()

  for (const [idx, sample] of samples.entries()) {
    for (const item of sample.timings.phases) {
      const list = phases.get(item.name) ?? []
      list.push(item.ms)
      phases.set(item.name, list)
    }

    const snap = sample.native
    if (!snap) {
      for (const list of total.values()) list.push(0)
      for (const map of rows.values()) {
        for (const list of map.values()) list.push(0)
      }
      continue
    }

    for (const [key, value] of Object.entries(snap.total)) {
      const list = total.get(key) ?? Array.from({ length: idx }, () => 0)
      list.push(value)
      total.set(key, list)
    }

    const seen = new Set<string>()
    for (const item of snap.rows) {
      seen.add(item.name)
      const map = rows.get(item.name) ?? new Map<string, number[]>()
      for (const key of ["calls", "fails", "totalMs", "inBytes", "outBytes"] as const) {
        const list = map.get(key) ?? Array.from({ length: idx }, () => 0)
        list.push(item[key])
        map.set(key, list)
      }
      rows.set(item.name, map)
    }
    for (const name of rows.keys()) {
      if (seen.has(name)) continue
      const map = rows.get(name)!
      for (const key of ["calls", "fails", "totalMs", "inBytes", "outBytes"] as const) {
        const list = map.get(key) ?? []
        list.push(0)
        map.set(key, list)
      }
    }
  }

  const summary: Summary = {
    elapsedMs: stat(samples.map((item) => item.run.elapsedMs)),
    totalMs: stat(samples.map((item) => item.timings.totalMs)),
    phases: Object.fromEntries(
      [...phases.entries()]
        .map(([name, vals]) => [name, stat(vals)] as const)
        .sort((a, b) => b[1].median - a[1].median),
    ),
  }

  if (total.size === 0) return summary

  summary.native = {
    total: Object.fromEntries([...total.entries()].map(([key, vals]) => [key, stat(vals)])) as Native["total"],
    rows: Object.fromEntries(
      [...rows.entries()]
        .map(([name, map]) => {
          const item = Object.fromEntries(
            [...map.entries()].map(([key, vals]) => [key, stat(vals)]),
          ) as Native["rows"][string]
          return [name, item] as const
        })
        .sort((a, b) => b[1].totalMs.median - a[1].totalMs.median),
    ),
  }

  return summary
}

function num(value: number, digits = 2) {
  return Number.isInteger(value) ? String(value) : value.toFixed(digits)
}

function print(label: string, value: Stat, unit = "ms") {
  console.log(
    `  ${label}: median ${num(value.median)}${unit} | mean ${num(value.mean)}${unit} | min ${num(value.min)}${unit} | max ${num(value.max)}${unit}`,
  )
}

async function files(limit?: number) {
  const list: string[] = []
  for await (const rel of Ripgrep.files({ cwd: Instance.directory })) {
    const abs = path.join(Instance.directory, rel)
    if (!isIndexableFile(abs)) continue
    list.push(abs)
    if (limit !== undefined && list.length >= limit) break
  }
  return list
}

async function run(
  list: string[],
  args: {
    concurrency: number
    limit?: number
    probe: boolean
    nativeProfile: boolean
  },
  probeResult?: Bench["probeResult"],
): Promise<IndexReport> {
  if (args.nativeProfile) NativePerf.reset()
  const start = Date.now()
  const result = await CodeIntelligence.indexFiles(Instance.project.id, list, {
    concurrency: args.concurrency,
    lock: "acquire",
    lockTimeoutMs: 30 * 60 * 1000,
    pruneOrphans: false,
    force: true,
  })
  const elapsedMs = Date.now() - start
  const status = CodeIntelligence.status(Instance.project.id)
  const native = args.nativeProfile ? NativePerf.snapshot() : undefined
  if (args.nativeProfile) NativePerf.reset()

  return buildIndexReport({
    projectID: Instance.project.id,
    directory: Instance.directory,
    worktree: Instance.worktree,
    concurrency: args.concurrency,
    limit: args.limit,
    probe: args.probe,
    nativeProfile: args.nativeProfile,
    files: list.length,
    status,
    result,
    elapsedMs,
    probeResult,
    native,
  })
}

const PerfIndexCommand = cmd({
  command: "index",
  describe: "benchmark repeated code-intelligence indexing runs",
  builder: (yargs: Argv) =>
    yargs
      .option("concurrency", {
        describe: "max concurrent indexing jobs",
        type: "number",
        default: 4,
      })
      .option("limit", {
        describe: "cap the number of files to benchmark",
        type: "number",
      })
      .option("repeat", {
        describe: "number of measured samples",
        type: "number",
        default: 3,
      })
      .option("warmup", {
        describe: "number of warmup runs before sampling",
        type: "number",
        default: 1,
      })
      .option("probe", {
        describe: "probe LSP readiness before benchmarking",
        type: "boolean",
        default: false,
      })
      .option("native-profile", {
        describe: "collect native bridge profiling for each sample",
        type: "boolean",
        default: false,
      })
      .option("json", {
        describe: "output machine-readable JSON",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    const repeat = int(args.repeat, "repeat", 1)
    const warmup = int(args.warmup, "warmup", 0)
    const limit = args.limit === undefined ? undefined : int(args.limit, "limit", 1)
    const json = args.json === true
    const nativeProfile = args.nativeProfile === true

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (nativeProfile) {
          process.env.AX_CODE_PROFILE_NATIVE = "1"
          NativePerf.install()
        }

        const list = await files(limit)
        let probeResult: Bench["probeResult"] | undefined

        if (args.probe && list.length > 0) {
          const probe = await probeLspServers(groupFilesByLanguage(list))
          probeResult = {
            ready: [...probe.ready].sort(),
            missing: Object.fromEntries([...probe.missing.entries()].sort(([a], [b]) => a.localeCompare(b))),
          }
        }

        if (!json) {
          console.log("")
          console.log("  ax-code debug perf index")
          console.log("")
          console.log(`  project:  ${Instance.project.id}`)
          console.log(`  files:    ${list.length}`)
          console.log(`  warmup:   ${warmup}`)
          console.log(`  samples:  ${repeat}`)
          if (probeResult) {
            console.log(
              `  probe:    ${probeResult.ready.length} ready, ${Object.keys(probeResult.missing).length} missing`,
            )
          }
          console.log("")
        }

        if (list.length === 0) {
          const report: Bench = {
            projectID: Instance.project.id,
            directory: Instance.directory,
            worktree: Instance.worktree,
            requested: {
              concurrency: args.concurrency,
              limit,
              probe: args.probe,
              repeat,
              warmup,
              nativeProfile,
            },
            files: 0,
            probeResult,
            samples: [],
            summary: summarize([]),
          }
          if (json) {
            process.stdout.write(JSON.stringify(report, null, 2) + EOL)
            return
          }
          console.log("  no indexable files found")
          console.log("")
          return
        }

        for (let i = 0; i < warmup; i++) {
          if (!json) console.log(`  warmup ${i + 1}/${warmup}`)
          await run(
            list,
            {
              concurrency: args.concurrency,
              limit,
              probe: args.probe,
              nativeProfile,
            },
            probeResult,
          )
        }

        const samples: IndexReport[] = []
        for (let i = 0; i < repeat; i++) {
          if (!json) console.log(`  sample ${i + 1}/${repeat}`)
          samples.push(
            await run(
              list,
              {
                concurrency: args.concurrency,
                limit,
                probe: args.probe,
                nativeProfile,
              },
              probeResult,
            ),
          )
        }

        const summary = summarize(samples)
        const report: Bench = {
          projectID: Instance.project.id,
          directory: Instance.directory,
          worktree: Instance.worktree,
          requested: {
            concurrency: args.concurrency,
            limit,
            probe: args.probe,
            repeat,
            warmup,
            nativeProfile,
          },
          files: list.length,
          probeResult,
          samples,
          summary,
        }

        if (json) {
          process.stdout.write(JSON.stringify(report, null, 2) + EOL)
          return
        }

        console.log("")
        print("elapsed", summary.elapsedMs)
        print("builder.total", summary.totalMs)
        console.log("")
        console.log("  phases:")
        for (const [name, value] of Object.entries(summary.phases)) {
          print(name, value)
        }
        if (summary.native) {
          console.log("")
          console.log("  native totals:")
          print("calls", summary.native.total.calls, "")
          print("fails", summary.native.total.fails, "")
          print("totalMs", summary.native.total.totalMs)
          print("inBytes", summary.native.total.inBytes, "B")
          print("outBytes", summary.native.total.outBytes, "B")
          if (Object.keys(summary.native.rows).length > 0) {
            console.log("")
            console.log("  native rows:")
            for (const [name, value] of Object.entries(summary.native.rows)) {
              print(name, value.totalMs)
            }
          }
        }
      },
    })
  },
})

export const PerfCommand = cmd({
  command: "perf",
  describe: "performance profiling helpers",
  builder: (yargs: Argv) => yargs.command(PerfIndexCommand).demandCommand(),
  async handler() {},
})
