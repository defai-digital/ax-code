/**
 * Local ensemble call ledger (ADR-102). Operational debug data, not AX
 * Telemetry: JSONL under the global state directory with a 2 MB cap and
 * tail retention. Records carry a SHA-256 prompt hash only — never prompt
 * bodies, never credentials. `modes.ensembleLedger: false` opts out.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "../global"
import type { FanOut } from "../util/fan-out"
import { FileLock } from "../util/filelock"
import { Log } from "../util/log"

export namespace EnsembleLedger {
  const log = Log.create({ service: "mode.ensemble-ledger" })
  const MAX_BYTES = 2 * 1024 * 1024
  const RETAIN_BYTES = 1024 * 1024
  let writeChain: Promise<void> = Promise.resolve()

  export type Outcome = "ok" | "timeout" | "aborted" | "error"

  export type Entry = {
    at: number
    tool: "council" | "arena"
    memberId: string
    /** Logical stage, e.g. "fanout", "debate-2", "chairman", "judge", "plan", "implement". */
    phase?: string
    outcome: Outcome
    durationMs: number
    timeoutMs: number
    /** SHA-256 of the system+user prompt. Never the prompt text. */
    promptHash?: string
    /** Bounded, body-free failure label (see FanOut.describeError). */
    error?: string
  }

  export function ledgerPath() {
    return path.join(Global.Path.state, "ensemble-calls.jsonl")
  }

  /**
   * Wait for every queued write to flush. Used by tests and graceful
   * shutdown; normal callers never need it (writes are fire-and-forget).
   */
  export function drain(): Promise<void> {
    return writeChain
  }

  /**
   * Pure tail-retention for the size cap: keep the last `retainBytes` of
   * `raw`, starting at a line boundary. Exported for tests.
   */
  export function truncateToCap(raw: string, maxBytes: number, retainBytes: number): string {
    if (Buffer.byteLength(raw, "utf8") <= maxBytes) return raw
    const tail = raw.slice(raw.length - retainBytes)
    const firstNewline = tail.indexOf("\n")
    return firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail
  }

  /**
   * Fire-and-forget append with a size cap. Writes are serialized in-process
   * and lock-protected cross-process; failures are logged, never thrown.
   */
  export function record(entry: Entry): void {
    writeChain = writeChain.then(async () => {
      try {
        const target = ledgerPath()
        using _lock = await FileLock.acquire(target)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.appendFile(target, JSON.stringify(entry) + "\n", "utf8")
        const stat = await fs.stat(target).catch(() => undefined)
        if (stat && stat.size > MAX_BYTES) {
          const raw = await fs.readFile(target, "utf8")
          await fs.writeFile(target, truncateToCap(raw, MAX_BYTES, RETAIN_BYTES), "utf8")
        }
      } catch (error) {
        log.warn("ensemble ledger write failed", { error })
      }
    })
  }

  /**
   * Build the FanOut telemetry hook for one logical generation. Returns
   * undefined when the ledger is disabled so callers can pass it straight
   * into FanOut.run.
   */
  export function telemetryFor<T>(input: {
    enabled: boolean
    tool: Entry["tool"]
    timeoutMs: number
    phase?: string
    promptHash?: string
    memberId: (member: T) => string
  }): ((event: FanOut.TelemetryEvent<T>) => void) | undefined {
    if (!input.enabled) return undefined
    return (event) =>
      record({
        at: Date.now(),
        tool: input.tool,
        memberId: input.memberId(event.member),
        phase: input.phase,
        outcome: event.outcome,
        durationMs: event.durationMs,
        timeoutMs: input.timeoutMs,
        promptHash: input.promptHash,
        ...(event.error ? { error: event.error.slice(0, 200) } : {}),
      })
  }
}
