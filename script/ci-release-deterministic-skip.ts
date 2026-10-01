import path from "node:path"
import { fileURLToPath } from "node:url"

export const DETERMINISTIC_SHARD_NAMES = [
  "deterministic (1/4)",
  "deterministic (2/4)",
  "deterministic (3/4)",
  "deterministic (4/4)",
] as const

export type CheckRun = {
  name: string
  status: string
  conclusion: string
  completedAt: string
}

export function parseCheckRunTsv(text: string): CheckRun[] {
  const runs: CheckRun[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [name, status, conclusion, completedAt] = line.split("\t")
    if (!name || !status || completedAt === undefined) continue
    runs.push({ name, status, conclusion: conclusion ?? "", completedAt })
  }
  return runs
}

// Release validate re-runs the full deterministic suite on one machine.
// Skip that only when every shard's latest check on this SHA succeeded.
export function deterministicSuiteAlreadyPassed(runs: readonly CheckRun[]): boolean {
  for (const name of DETERMINISTIC_SHARD_NAMES) {
    const matching = runs.filter((run) => run.name === name)
    if (matching.length === 0) return false
    const latestAt = matching.reduce((max, run) => (run.completedAt > max ? run.completedAt : max), "")
    const latest = matching.filter((run) => run.completedAt === latestAt)
    if (!latest.every((run) => run.status === "completed" && run.conclusion === "success")) return false
  }
  return true
}

async function readStdin() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

async function main() {
  const text = process.argv.length > 2 ? process.argv.slice(2).join("\n") : await readStdin()
  process.exitCode = deterministicSuiteAlreadyPassed(parseCheckRunTsv(text)) ? 0 : 1
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  void main()
}
