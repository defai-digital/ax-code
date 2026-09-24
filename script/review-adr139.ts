// ADR-139 multi-CLI bug-hunt harness.
//
// Runs external reviewers against an inlined slice of the ADR-139
// token-accounting code (read from HEAD, i.e. the code as committed) and
// persists their verdicts to .internal/reports/adr139/verify-reviews.json. The check exits 0 only when
// at least two reviewers each return a structured verdict plus a non-empty
// findings list — the project-owned evidence for AC1.
//
// Design notes:
//   - Sources are read with `git show HEAD:<path>` so the reviewers audit the
//     committed code, not the working tree the fix is being built in. This is
//     the honest "find bugs in what shipped" task.
//   - Every reviewer is forced into JSON via a shared --output-schema, so a
//     verdict is machine-checkable and the model cannot ramble past the
//     deadline.
//   - The full tool surface is disabled (see ALL_TOOLS) so a reviewer cannot
//     wander off into repository exploration and miss the deadline. Unknown
//     tool ids only warn, so the list is deliberately broad.
//   - Reviewers run in parallel and the slowest are killed as soon as two
//     have reported findings, so the check does not wait on a stalled model.
//
// The script is idempotent: if .internal/reports/adr139/verify-reviews.json already exists and is
// younger than REVIEW_TTL_MS, it exits 0 without re-running the network
// calls. Delete the file or pass --force to rerun.

import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises"
import { existsSync, statSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const ROOT = path.resolve(import.meta.dirname, "..")
const OUT = path.join(ROOT, ".internal/reports/adr139/verify-reviews.json")
const REVIEW_TTL_MS = 60 * 60 * 1_000 // 1 hour
const PER_REVIEWER_TIMEOUT_MS = 420_000
const REQUIRED_REVIEWERS = 2

const ALL_TOOLS = [
  "bash",
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "list",
  "apply_patch",
  "todowrite",
  "todoread",
  "task",
  "code_intelligence",
  "lsp",
  "codesearch",
  "webfetch",
  "websearch",
  "skill",
  "question",
  "batch",
  "diagnostics",
  "context_status",
  "context_recover",
  "memory_save",
  "symbol_note",
  "impact_analyze",
  "council",
  "arena",
  "notebook_edit",
  "image_gen",
  "bash_input",
  "bash_output",
  "computer_snapshot",
  "computer_action",
  "computer_watch",
  "computer_plan",
].join(",")

// Focused slices of the HEAD sources. Omit `range` to read the whole file.
const SLICES: Array<{ rel: string; range?: [number, number] }> = [
  { rel: "packages/ax-code/src/session/compaction-budget.ts" },
  { rel: "packages/ax-code/src/provider/token-ledger.ts", range: [193, 389] },
  { rel: "packages/ax-code/src/provider/observed-window.ts", range: [269, 382] },
]

function headFile(rel: string): string {
  return execFileSync("git", ["show", `HEAD:${rel}`], { cwd: ROOT, encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 })
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
}

function numbered(src: string, range?: [number, number]): string {
  const lines = src.split("\n")
  const start = range ? range[0] : 1
  const end = range ? range[1] : lines.length
  const out: string[] = []
  for (let i = start; i <= end && i <= lines.length; i++) {
    out.push(`${String(i).padStart(5)}  ${lines[i - 1] ?? ""}`)
  }
  return stripComments(out.join("\n"))
}

function composePrompt(): string {
  const header = `Audit the ADR-139 token-accounting functions below (committed HEAD code) for CONTRACT VIOLATIONS and concrete bugs. Answer ONLY with JSON matching the provided schema. Always include a non-empty "verdict" string. Do not describe your process.

Check these contracts explicitly:
1. completionClamp documents "returns undefined when the remaining window is at or below the output floor". Does its RETURNED value always exceed OUTPUT_FLOOR when it is defined? Prove any counterexample.
2. calculateCompactionBudget: do cap/reserved/usable compose correctly for an observed window, limit.input === 0, and ax-engine's output floor?
3. SessionTokenLedger.recordAnchor/current/findEntry: can measured+estimated double-count or silently under-count? Is the anchor ring / prefix match sound?
4. ObservedWindowStore.recordSuccess/recordOverflow: any state persisted or clamped wrongly (floor, confirmations, catalog fingerprint, unknown routes)?

For each defect give file, the exact line number shown in the margin, a short title, its impact, and a minimal reproducer input. Report every defect you can defend. If you find none, return an empty findings array.

`
  const parts: string[] = [header]
  for (const { rel, range } of SLICES) {
    parts.push(`===== ${rel} (HEAD) =====`)
    parts.push(numbered(headFile(rel), range))
    parts.push("")
  }
  return parts.join("\n")
}

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings"],
  properties: {
    verdict: { type: "string", description: "One-sentence summary of what you found (required)." },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "line", "title", "impact", "reproducer"],
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          title: { type: "string" },
          impact: { type: "string" },
          reproducer: { type: "string" },
        },
      },
    },
  },
}

type RunResult = {
  reviewer: string
  command: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  killed: boolean
  error: string | null
  stdout: string
  stderr: string
  durationMs: number
}

type Launched = { reviewer: string; promise: Promise<RunResult>; kill: () => void }

function launch(args: {
  cmd: string
  args: readonly string[]
  cwd?: string
  reviewer: string
  timeoutMs: number
}): Launched {
  const started = Date.now()
  let killed = false
  const child: ChildProcess = spawn(args.cmd, [...args.args], {
    cwd: args.cwd,
    env: { ...process.env, AX_CODE_QUIET: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
    setTimeout(() => child.kill("SIGKILL"), 5_000).unref()
  }, args.timeoutMs).unref()
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf-8")
    if (stdout.length > 200_000) stdout = stdout.slice(0, 200_000)
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf-8")
    if (stderr.length > 60_000) stderr = stderr.slice(0, 60_000)
  })
  const promise = new Promise<RunResult>((resolve) => {
    const done = (code: number | null, signal: NodeJS.Signals | null, error: string | null) => {
      clearTimeout(timer)
      resolve({
        reviewer: args.reviewer,
        command: `${args.cmd} ${args.args.join(" ")}`,
        exitCode: code,
        signal,
        timedOut,
        killed,
        error,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      })
    }
    child.on("error", (err) => done(null, null, err.message))
    child.on("close", (code, signal) => done(code, signal, null))
  })
  return {
    reviewer: args.reviewer,
    promise,
    kill: () => {
      killed = true
      child.kill("SIGTERM")
    },
  }
}

type Verdict = {
  reviewer: string
  exitCode: number | null
  timedOut: boolean
  killed: boolean
  durationMs: number
  verdict: string | null
  findingsCount: number
  findings: unknown
}

/** Pull the first JSON object out of mixed stdout (models sometimes prefix prose). */
function extractJson(stdout: string): { verdict?: string; findings?: unknown[] } | null {
  const trimmed = stdout.trim()
  const candidates: string[] = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  const first = trimmed.indexOf("{")
  const last = trimmed.lastIndexOf("}")
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1))
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c)
      if (parsed && typeof parsed === "object" && ("verdict" in parsed || "findings" in parsed)) {
        return parsed as { verdict?: string; findings?: unknown[] }
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

function toVerdict(r: RunResult): Verdict {
  const parsed = extractJson(r.stdout)
  const findings = parsed?.findings
  return {
    reviewer: r.reviewer,
    exitCode: r.exitCode,
    timedOut: r.timedOut,
    killed: r.killed,
    durationMs: r.durationMs,
    verdict: parsed?.verdict ?? null,
    findingsCount: Array.isArray(findings) ? findings.length : 0,
    findings: findings ?? null,
  }
}

function passes(v: Verdict): boolean {
  return (
    typeof v.verdict === "string" && v.verdict.trim().length > 0 && Array.isArray(v.findings) && v.findings.length > 0
  )
}

async function main() {
  const force = process.argv.includes("--force")
  if (!force && existsSync(OUT)) {
    const ageMs = Date.now() - statSync(OUT).mtimeMs
    if (ageMs < REVIEW_TTL_MS) {
      try {
        const cached = JSON.parse(await readFile(OUT, "utf-8"))
        const passed = (cached.reviewers as Verdict[]).filter(passes).length
        if (passed >= REQUIRED_REVIEWERS) {
          process.stdout.write(
            `.internal/reports/adr139/verify-reviews.json is fresh (${Math.round(ageMs / 1_000)}s old) with ${passed} reviewers reporting findings.\n`,
          )
          process.exit(0)
        }
      } catch {
        // Fall through and re-run.
      }
    }
  }

  const prompt = composePrompt()
  process.stdout.write(`prompt size: ${prompt.length} bytes\n`)

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "adr139-review-"))
  const promptPath = path.join(tmpDir, "prompt.md")
  const schemaPath = path.join(tmpDir, "schema.json")
  await writeFile(promptPath, prompt, "utf-8")
  await writeFile(schemaPath, JSON.stringify(OUTPUT_SCHEMA), "utf-8")

  const AX_ARGS = (model: string) => [
    "run",
    "--prompt-file",
    promptPath,
    "--model",
    model,
    "--sandbox",
    "read-only",
    "--output-schema",
    schemaPath,
    "--disallowed-tools",
    ALL_TOOLS,
  ]

  const specs: Array<{ id: string; cmd: string; args: readonly string[]; cwd?: string }> = [
    // Strong general reasoner — the primary finding source.
    {
      id: "codex",
      cmd: "codex",
      args: [
        "exec",
        "-s",
        "read-only",
        "--skip-git-repo-check",
        "-m",
        "gpt-5.6-sol",
        "--output-schema",
        schemaPath,
        "--",
        prompt,
      ],
      cwd: tmpDir,
    },
    { id: "glm-5.3", cmd: "ax-code", args: AX_ARGS("defai-01-ax-trust-com/glm-5.3") },
    { id: "nemotron-ultra", cmd: "ax-code", args: AX_ARGS("defai-01-ax-trust-com/nvidia/nemotron-3-ultra-550b-a55b") },
    {
      id: "nemotron-super",
      cmd: "ax-code",
      args: AX_ARGS("defai-01-ax-trust-com/nvidia/nemotron-3-super-120b-a12b"),
    },
    {
      id: "muse",
      cmd: "muse",
      args: [
        "exec",
        "--prompt-file",
        promptPath,
        "--workspace",
        tmpDir,
        "--approval-mode",
        "never",
        "--disable-write",
        "--disable-shell",
        "--disable-web-tools",
        "--no-session-log",
        "--no-foreign-personal-context",
        "--output-schema",
        schemaPath,
        "--max-model-steps",
        "6",
      ],
      cwd: tmpDir,
    },
  ]

  process.stdout.write(
    `running ${specs.length} reviewers in parallel (timeout ${PER_REVIEWER_TIMEOUT_MS / 1_000}s each, early-exit at ${REQUIRED_REVIEWERS})...\n`,
  )
  const launched = specs.map((s) =>
    launch({ cmd: s.cmd, args: s.args, cwd: s.cwd, reviewer: s.id, timeoutMs: PER_REVIEWER_TIMEOUT_MS }),
  )
  const byId = new Map(launched.map((l) => [l.reviewer, l]))

  let livePass = 0
  const allDone = Promise.all(
    launched.map((l) =>
      l.promise.then((res) => {
        const v = toVerdict(res)
        process.stdout.write(
          `  ${l.reviewer}: exit=${v.exitCode} findings=${v.findingsCount} timedOut=${v.timedOut} duration=${v.durationMs}ms\n`,
        )
        if (passes(v)) {
          livePass++
          if (livePass >= REQUIRED_REVIEWERS) {
            for (const other of launched) if (other.reviewer !== l.reviewer) byId.get(other.reviewer)!.kill()
          }
        }
        return res
      }),
    ),
  )
  const settled = await allDone

  const verdicts: Verdict[] = settled.map(toVerdict)
  const passed = verdicts.filter(passes)

  const payload = {
    generatedAt: new Date().toISOString(),
    promptBytes: prompt.length,
    sourceOfTruth: "HEAD",
    requiredReviewers: REQUIRED_REVIEWERS,
    reviewers: verdicts,
    raw: settled.map((r) => ({
      reviewer: r.reviewer,
      exitCode: r.exitCode,
      signal: r.signal,
      timedOut: r.timedOut,
      killed: r.killed,
      durationMs: r.durationMs,
      error: r.error,
      command: r.command,
      stdout: r.stdout.slice(0, 40_000),
      stderrHead: r.stderr.slice(0, 2_000),
    })),
    pass: passed.length,
  }
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(payload, null, 2), "utf-8")
  process.stdout.write(`wrote ${OUT}\n`)

  rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)

  if (passed.length < REQUIRED_REVIEWERS) {
    process.stderr.write(`FAIL: only ${passed.length} reviewer(s) returned a verdict + non-empty findings\n`)
    for (const v of verdicts) {
      process.stderr.write(
        `  - ${v.reviewer}: verdict=${JSON.stringify(v.verdict)} findingsCount=${v.findingsCount} timedOut=${v.timedOut}\n`,
      )
    }
    process.exit(1)
  }
  process.stdout.write(`PASS: ${passed.length} reviewer(s) reported findings\n`)
}

main().catch((error) => {
  process.stderr.write(`script error: ${(error as Error).stack ?? String(error)}\n`)
  process.exit(2)
})
