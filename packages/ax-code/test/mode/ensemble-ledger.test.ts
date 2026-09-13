import { afterEach, beforeEach, describe, expect, test } from "vitest"
import fs from "node:fs/promises"
import { EnsembleLedger } from "../../src/mode/ensemble-ledger"

// ADR-102: the ledger is local JSONL with prompt hashes only — these tests
// pin the redaction and retention contracts. Global state is per-PID
// isolated by the test setup, so writes never touch a developer file.
const entry = (over: Partial<EnsembleLedger.Entry> = {}): EnsembleLedger.Entry => ({
  at: Date.now(),
  tool: "council",
  memberId: "deepseek/deepseek-v4-pro",
  phase: "fanout",
  outcome: "ok",
  durationMs: 1234,
  timeoutMs: 180000,
  promptHash: "a".repeat(64),
  ...over,
})

beforeEach(async () => {
  await fs.rm(EnsembleLedger.ledgerPath(), { force: true })
})

afterEach(async () => {
  await fs.rm(EnsembleLedger.ledgerPath(), { force: true })
})

describe("EnsembleLedger", () => {
  test("appends valid redacted JSONL entries", async () => {
    EnsembleLedger.record(entry())
    EnsembleLedger.record(entry({ phase: "chairman", outcome: "timeout", error: "timeout: member exceeded 180000ms" }))
    await EnsembleLedger.drain()

    const raw = await fs.readFile(EnsembleLedger.ledgerPath(), "utf8")
    const lines = raw.trim().split("\n")
    expect(lines).toHaveLength(2)
    const parsed = lines.map((line) => JSON.parse(line))
    expect(parsed[0]).toMatchObject({ tool: "council", outcome: "ok", phase: "fanout", timeoutMs: 180000 })
    expect(parsed[1]).toMatchObject({ outcome: "timeout", phase: "chairman" })
    expect(parsed[0].promptHash).toMatch(/^[0-9a-f]{64}$/)
    // The whole point of the ledger: hashes, never bodies
    expect(raw).not.toContain("Review auth")
  })

  test("telemetryFor returns undefined when disabled and bounds errors when enabled", async () => {
    expect(
      EnsembleLedger.telemetryFor({ enabled: false, tool: "arena", timeoutMs: 1000, memberId: (m: string) => m }),
    ).toBeUndefined()

    const telemetry = EnsembleLedger.telemetryFor<string>({
      enabled: true,
      tool: "arena",
      timeoutMs: 60_000,
      phase: "judge",
      promptHash: "b".repeat(64),
      memberId: (m) => m,
    })
    expect(telemetry).toBeDefined()
    telemetry!({ member: "a/m", outcome: "error", durationMs: 5, error: "x".repeat(500) })
    await EnsembleLedger.drain()

    const parsed = JSON.parse((await fs.readFile(EnsembleLedger.ledgerPath(), "utf8")).trim())
    expect(parsed.tool).toBe("arena")
    expect(parsed.phase).toBe("judge")
    expect(parsed.memberId).toBe("a/m")
    expect(parsed.error.length).toBe(200)
  })

  test("truncateToCap keeps a line-aligned tail and leaves small files alone", () => {
    const raw = Array.from({ length: 100 }, (_, i) => `{"n":${i}}`).join("\n") + "\n"
    const out = EnsembleLedger.truncateToCap(raw, 100, 60)
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(60)
    expect(out.startsWith("{")).toBe(true)
    expect(out.endsWith("\n")).toBe(true)

    const small = `{"n":1}\n`
    expect(EnsembleLedger.truncateToCap(small, 100, 60)).toBe(small)
  })
})
