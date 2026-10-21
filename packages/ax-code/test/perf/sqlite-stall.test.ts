import { expect, test } from "vitest"

import { parseArgs, runMatrix } from "../../script/perf-sqlite-stall"
import { tmpdir } from "../fixture/fixture"

const NUMERIC_KEYS = [
  "burstSize",
  "writesScheduled",
  "writesActual",
  "writesCoalesced",
  "writeMsP50",
  "writeMsP95",
  "writeMsMax",
  "stallMsMax",
  "wallMs",
  "dbBytesBefore",
  "dbBytesAfter",
  "walBytesBefore",
  "walBytesAfter",
  "journalBytesBefore",
  "journalBytesAfter",
] as const

test("runMatrix reports finite stall metrics for WAL and DELETE", async () => {
  await using tmp = await tmpdir()
  const rows = await runMatrix({
    dir: tmp.path,
    bursts: [1, 2],
    journalModes: ["WAL", "DELETE"],
    windowMs: 0,
    windowFor: () => 0,
    deltasPerMessage: 3,
    deltaChars: 8,
    heartbeatMs: 5,
  })

  expect(rows).toHaveLength(4)
  for (const row of rows) {
    for (const key of NUMERIC_KEYS) {
      expect(Number.isFinite(row[key]), key).toBe(true)
    }
    expect(row.writesScheduled).toBeGreaterThanOrEqual(row.writesActual)
    expect(row.writesActual).toBeGreaterThanOrEqual(1)
    expect(row.writesCoalesced).toBe(row.writesScheduled - row.writesActual)
    if (row.journalMode === "WAL") {
      expect(typeof row.checkpointMs).toBe("number")
      expect(Number.isFinite(row.checkpointMs)).toBe(true)
    } else {
      expect(row.checkpointMs).toBeNull()
    }
    expect(row.wallMs).toBeGreaterThanOrEqual(0)
    expect(row.stallMsMax).toBeGreaterThanOrEqual(0)
  }
})

test("parseArgs reads bursts and keep", () => {
  const parsed = parseArgs(["--bursts", "1,2", "--keep"])
  expect(parsed.bursts).toEqual([1, 2])
  expect(parsed.keep).toBe(true)
  expect(typeof parsed.dir).toBe("string")
  expect(parsed.out).toBeUndefined()
})
