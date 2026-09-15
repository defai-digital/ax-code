#!/usr/bin/env -S npx tsx

/**
 * Verifies the captured headless review receipts for the TUI animation surface.
 *
 * Three external CLIs (grok, Claude Code, Codex) review the same bounded brief
 * per round and must each terminate with process exit 0 and a machine-readable
 * verdict. This script makes "a review happened and every finding has a
 * disposition" checkable instead of asserted: it rebuilds the verdict set from
 * the raw captured stdout, compares the reviewed revision with the round's
 * recorded revision, requires at least one round that matches the current HEAD,
 * and requires a disposition (fixed or rejected, with evidence) for every
 * finding any round reported.
 *
 * Usage:
 *   pnpm --dir packages/ax-code exec tsx script/verify-cli-review-receipts.ts
 *   pnpm --dir packages/ax-code exec tsx script/verify-cli-review-receipts.ts --root <dir> --revision <sha>
 *   pnpm --dir packages/ax-code exec tsx script/verify-cli-review-receipts.ts --root <dir> --clis muse,claude,codex
 *
 * The reviewed CLI roster defaults to grok,claude,codex. `--clis` selects an
 * explicit roster; each name must have a receipt contract in CLI_STDOUT.
 *
 * Layout (default root .internal/reports/cli-animation-review):
 *   round-1/revision.txt              revision the round reviewed
 *   round-1/grok/{exit.txt,stdout.jsonl}
 *   round-1/muse/{exit.txt,stdout.jsonl}
 *   round-1/claude/{exit.txt,stdout.txt}
 *   round-1/codex/{exit.txt,stdout.txt}
 *   dispositions.json                 every finding with its disposition
 */

import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runReviewRegressions, validateRegression, type ReviewRegression } from "./cli-review-regressions"
import { parseJsonPayload } from "../src/util/json-value"

/**
 * How a CLI encodes its answer on stdout.
 *
 * - `text`       — the final answer is written as plain text (Claude Code, Codex).
 * - `jsonl`      — grok streaming JSONL: text arrives as `{"type":"text","data":...}`
 *                  events that must be concatenated with no separator.
 * - `muse-jsonl` — muse durable JSONL: text arrives as `run.output.delta` payloads
 *                  (`payload.text`) with the consolidated answer also recorded on
 *                  `run.terminal.completed`. Deltas are preferred so the answer is
 *                  reassembled exactly once.
 */
export type VerdictFormat = "text" | "jsonl" | "muse-jsonl"

/** Per-CLI receipt contract: the stdout file name and how its answer is encoded. */
export const CLI_STDOUT: Record<string, { file: string; format: VerdictFormat }> = {
  grok: { file: "stdout.jsonl", format: "jsonl" },
  muse: { file: "stdout.jsonl", format: "muse-jsonl" },
  claude: { file: "stdout.txt", format: "text" },
  codex: { file: "stdout.txt", format: "text" },
}

const DEFAULT_CLIS = ["grok", "claude", "codex"] as const

export namespace CliReviewReceipts {
  export const DefaultRoot = ".internal/reports/cli-animation-review"
  export const DefaultClis: readonly string[] = DEFAULT_CLIS
  export const RevisionFile = "revision.txt"
  export const DispositionsFile = "dispositions.json"
  export const RoundPrefix = "round-"
  export const RevisionPattern = /^[0-9a-f]{7,40}$/
}

export type ReceiptFinding = {
  id: string
  severity: string
  file: string
  line: number
  summary: string
}

export type ReceiptVerdict = {
  verdict: "findings" | "no_findings"
  reviewedRevision: string
  findings: ReceiptFinding[]
}

export type Disposition = {
  round: string
  cli: string
  id: string
  status: "fixed" | "rejected"
  evidence: string
  regression?: ReviewRegression
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

/**
 * Pull every balanced, parseable JSON object that carries a `verdict` key out of
 * arbitrary reviewer output. Handles plain text answers, fenced blocks, and
 * streaming JSONL (where the answer text arrives as a series of `text` events).
 *
 * Streaming JSONL is reassembled by concatenating the `data` of every `text`
 * event with no separator. `thought` and control events are ignored: joining
 * them (or inserting newlines between fragments) corrupts the verdict JSON, which
 * is why the previous newline-join could never parse grok's answer.
 */
export function extractVerdicts(raw: string, format: VerdictFormat = "text"): ReceiptVerdict[] {
  if (format === "text") return scanBalancedObjects(raw)
  if (format === "muse-jsonl") return scanBalancedObjects(reassembleMuseOutput(raw))
  const parts: string[] = []
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    const parsed = parseJsonPayload(line)
    if (!isRecord(parsed)) return []
    if (typeof parsed.type === "string") {
      if (parsed.type === "text" && typeof parsed.data === "string") parts.push(parsed.data)
      continue
    }
    // Admit a complete verdict as one JSONL record, without stripping its fields.
    if ("verdict" in parsed) parts.push(line)
  }
  return scanBalancedObjects(parts.join(""))
}

/**
 * Reassemble muse's durable-JSONL answer. Assistant text is streamed as
 * `run.output.delta` payloads; `run.terminal.completed` repeats the consolidated
 * answer. Concatenating only the deltas avoids counting the same verdict twice,
 * and the terminal text is a fallback for a run that emitted no deltas.
 */
function reassembleMuseOutput(raw: string): string {
  const deltas: string[] = []
  let terminal: string | undefined
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    const parsed = parseJsonPayload(line)
    if (!isRecord(parsed)) continue
    const payload = isRecord(parsed.payload) ? parsed.payload : undefined
    if (!payload || typeof payload.text !== "string") continue
    if (parsed.payload_type === "run.output.delta") deltas.push(payload.text)
    else if (parsed.payload_type === "run.terminal.completed") terminal = payload.text
  }
  return deltas.length > 0 ? deltas.join("") : (terminal ?? "")
}

function scanBalancedObjects(text: string): ReceiptVerdict[] {
  const verdicts: ReceiptVerdict[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{") {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (char === "}") {
      if (depth === 0) continue
      depth--
      if (depth !== 0 || start < 0) continue
      const candidate = parseJsonPayload(text.slice(start, i + 1))
      if (isRecord(candidate) && "verdict" in candidate) {
        const verdict = normalizeVerdict(candidate)
        if (verdict) verdicts.push(verdict)
      }
      start = -1
    }
  }
  return verdicts
}

function normalizeVerdict(value: Record<string, unknown>): ReceiptVerdict | undefined {
  const verdict = value.verdict
  if (verdict !== "findings" && verdict !== "no_findings") return undefined
  const reviewedRevision = asString(value.reviewed_revision)
  if (!reviewedRevision) return undefined
  const rawFindings = value.findings
  if (!Array.isArray(rawFindings) || (verdict === "findings" && rawFindings.length === 0)) return undefined
  const findings: ReceiptFinding[] = []
  for (const item of rawFindings) {
    if (!isRecord(item)) return undefined
    const id = asString(item.id)
    const severity = asString(item.severity)
    const file = asString(item.file)
    const summary = asString(item.summary)
    const line = typeof item.line === "number" ? item.line : Number.NaN
    if (!id || !severity || !file || !summary || !Number.isInteger(line) || line < 1) return undefined
    findings.push({ id, severity, file, line, summary })
  }
  return { verdict, reviewedRevision, findings }
}

function readTextFile(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, "utf8") : undefined
}

function listRounds(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root)
    .filter((entry) => entry.startsWith(CliReviewReceipts.RoundPrefix))
    .filter((entry) => statSync(path.join(root, entry)).isDirectory())
    .sort()
}

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
}

export function currentRevision(root: string): string {
  return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
}

type ParsedArgs = { root: string; revision?: string; quiet: boolean; clis: string[] }

export function parseArgs(argv: string[], root: string): ParsedArgs {
  let reviewRoot = path.join(root, CliReviewReceipts.DefaultRoot)
  let revision: string | undefined
  let quiet = false
  let clis: string[] = [...DEFAULT_CLIS]
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--root") reviewRoot = path.resolve(argv[++i] ?? "")
    else if (arg === "--revision") revision = argv[++i]
    else if (arg === "--clis")
      clis = (argv[++i] ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    else if (arg === "--quiet") quiet = true
  }
  return { root: reviewRoot, revision, quiet, clis }
}

export function verify(options: { root: string; revision: string; clis?: readonly string[] }): {
  failures: string[]
  lines: string[]
  regressions: ReviewRegression[]
} {
  const failures: string[] = []
  const lines: string[] = []
  const regressions: ReviewRegression[] = []
  const { root, revision } = options
  const clis = options.clis ?? DEFAULT_CLIS

  if (clis.length === 0) failures.push("no CLI selected; pass --clis <name,name>")
  for (const cli of clis) {
    if (!CLI_STDOUT[cli]) failures.push(`unknown CLI ${cli}; known: ${Object.keys(CLI_STDOUT).join(", ")}`)
  }

  if (!existsSync(root)) {
    return { failures: [`receipt root does not exist: ${root}`], lines, regressions }
  }

  const rounds = listRounds(root)
  if (rounds.length === 0) failures.push(`no round-* directory under ${root}`)

  const seenFindings = new Map<string, ReceiptFinding>()
  const currentRounds = new Set<string>()
  let finalRound: string | undefined

  for (const round of rounds) {
    const roundDir = path.join(root, round)
    const roundRevision = readTextFile(path.join(roundDir, CliReviewReceipts.RevisionFile))?.trim()
    if (!roundRevision || !CliReviewReceipts.RevisionPattern.test(roundRevision)) {
      failures.push(`${round}: missing or malformed ${CliReviewReceipts.RevisionFile}`)
      continue
    }
    if (roundRevision === revision) {
      finalRound = finalRound ?? round
      currentRounds.add(round)
    }
    for (const cli of clis) {
      const spec = CLI_STDOUT[cli]
      if (!spec) continue
      const cliDir = path.join(roundDir, cli)
      const exitRaw = readTextFile(path.join(cliDir, "exit.txt"))?.trim()
      const stdoutFile = path.join(cliDir, spec.file)
      const stdout = readTextFile(stdoutFile)
      if (exitRaw === undefined) {
        failures.push(`${round}/${cli}: missing exit.txt`)
        continue
      }
      if (exitRaw !== "0") {
        failures.push(`${round}/${cli}: process exit ${exitRaw || "<empty>"} (expected 0)`)
        continue
      }
      if (!stdout || stdout.trim().length === 0) {
        failures.push(`${round}/${cli}: empty review output at ${path.relative(root, stdoutFile)}`)
        continue
      }
      const verdicts = extractVerdicts(stdout, spec.format)
      if (verdicts.length > 1) failures.push(`${round}/${cli}: multiple verdicts are ambiguous`)
      const last = verdicts.at(-1)
      if (!last) {
        failures.push(`${round}/${cli}: no terminal verdict JSON carrying a "verdict" key`)
        continue
      }
      if (last.reviewedRevision !== roundRevision) {
        failures.push(
          `${round}/${cli}: verdict reviewed_revision ${last.reviewedRevision} does not match round revision ${roundRevision}`,
        )
      }
      if (last.verdict === "no_findings" && last.findings.length > 0) {
        failures.push(`${round}/${cli}: verdict is no_findings but lists ${last.findings.length} findings`)
      }
      for (const finding of last.findings) {
        const key = `${round}/${cli}/${finding.id}`
        if (seenFindings.has(key)) failures.push(`${round}/${cli}: duplicate finding id ${finding.id}`)
        seenFindings.set(key, finding)
      }
      lines.push(
        `${round}/${cli}: exit 0, verdict=${last.verdict}, findings=${last.findings.length}, revision=${last.reviewedRevision}`,
      )
    }
  }

  if (!finalRound) {
    failures.push(`no round reviewed the current revision ${revision}; the fixed revision needs its own review round`)
  } else {
    lines.push(`final revision ${revision} reviewed by ${finalRound}`)
  }

  const dispositionsRaw = readTextFile(path.join(root, CliReviewReceipts.DispositionsFile))
  const parsedDispositions = parseJsonPayload(dispositionsRaw)
  const dispositionList: Disposition[] = []
  if (!isRecord(parsedDispositions) || !Array.isArray(parsedDispositions.findings)) {
    failures.push(`${CliReviewReceipts.DispositionsFile}: missing or malformed findings array`)
  } else {
    for (const entry of parsedDispositions.findings) {
      if (!isRecord(entry)) {
        failures.push(`${CliReviewReceipts.DispositionsFile}: non-object entry`)
        continue
      }
      const round = asString(entry.round)
      const cli = asString(entry.cli)
      const id = asString(entry.id)
      const status = entry.status
      const evidence = asString(entry.evidence)
      if (!round || !cli || !id || (status !== "fixed" && status !== "rejected")) {
        failures.push(`${CliReviewReceipts.DispositionsFile}: entry needs round, cli, id and status fixed|rejected`)
        continue
      }
      if (!evidence) {
        failures.push(`${CliReviewReceipts.DispositionsFile}: ${round}/${cli}/${id} has no evidence`)
      }
      if (status === "fixed" && currentRounds.has(round))
        failures.push(`${round}/${cli}/${id}: fixed findings require a new revision and review round`)
      const regression = validateRegression(entry.regression)
      if (status === "fixed" && !regression)
        failures.push(
          `${CliReviewReceipts.DispositionsFile}: ${round}/${cli}/${id} requires regression.file and regression.fullName`,
        )
      if (status === "fixed" && regression) regressions.push(regression)
      dispositionList.push({ round, cli, id, status, evidence: evidence ?? "", regression })
    }
  }

  const dispositionKeys = new Set<string>()
  for (const entry of dispositionList) {
    const key = `${entry.round}/${entry.cli}/${entry.id}`
    if (dispositionKeys.has(key)) failures.push(`duplicate disposition ${key}`)
    dispositionKeys.add(key)
  }
  for (const key of seenFindings.keys()) {
    if (!dispositionKeys.has(key)) failures.push(`finding ${key} has no disposition`)
  }
  for (const entry of dispositionList) {
    const key = `${entry.round}/${entry.cli}/${entry.id}`
    if (!seenFindings.has(key)) failures.push(`disposition ${key} does not match any reported finding`)
    else
      lines.push(
        `disposition ${key}: ${entry.status}${entry.status === "fixed" ? " (regression declared; execution required)" : " (recorded reviewer judgment)"}`,
      )
  }

  return { failures, lines, regressions }
}

export function reviewSourceDirty(root: string): boolean {
  return (
    execFileSync(
      "git",
      [
        "-C",
        root,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
        "packages/ax-code",
        ":(exclude)packages/ax-code/ax-code.json",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "docs/guides/tui-animations.md",
      ],
      { encoding: "utf8" },
    ).length > 0
  )
}

async function main(): Promise<void> {
  const root = repoRoot()
  const args = parseArgs(process.argv.slice(2), root)
  const revision = args.revision ?? currentRevision(root)
  const { failures, lines, regressions } = verify({ root: args.root, revision, clis: args.clis })
  if (currentRevision(root) !== revision) failures.push("Requested review revision does not match repository HEAD")
  if (reviewSourceDirty(root))
    failures.push("Reviewed source has uncommitted changes; commit it and capture a matching review round")
  if (failures.length === 0) {
    failures.push(...(await runReviewRegressions(root, regressions)))
    if (reviewSourceDirty(root)) failures.push("Reviewed source changed during regression execution")
    if (currentRevision(root) !== revision)
      failures.push("Repository HEAD changed or does not match the reviewed revision")
    if (failures.length === 0 && regressions.length)
      lines.push(
        `${regressions.length} referenced regression assertions passed; this does not establish semantic bug coverage`,
      )
  }
  if (!args.quiet) for (const line of lines) console.log(line)
  if (failures.length > 0) {
    console.error(`\ncli review receipt verification failed (${failures.length}):`)
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log(
    `\nOK: ${args.clis.length} CLIs, ${lines.filter((l) => l.includes("exit 0")).length} receipts, revision ${revision}`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
