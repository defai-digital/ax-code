import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { doctor } from "../../src/memory/doctor"
import { recordEntry } from "../../src/memory/recorder"
import * as store from "../../src/memory/store"
import type { ProjectMemory } from "../../src/memory/types"

describe("memory.doctor", () => {
  test("reports ok for empty stores", async () => {
    await using tmp = await tmpdir()
    await store.clearGlobal().catch(() => {})

    const report = await doctor(tmp.path)

    expect(report.status).toBe("ok")
    expect(report.issues).toEqual([])
    expect(report.summary).toEqual({ total: 0, warnings: 0, errors: 0, byCode: {} })
    expect(report.checked).toEqual({ project: true, global: true })
  })

  test("detects expired and low-confidence entries", async () => {
    await using tmp = await tmpdir()
    const now = new Date("2026-01-02T00:00:00.000Z")

    await recordEntry(tmp.path, "feedback", {
      name: "old-rule",
      body: "Old rule",
      expiresAt: "2026-01-01T00:00:00.000Z",
    })
    await recordEntry(tmp.path, "feedback", {
      name: "uncertain-rule",
      body: "Uncertain rule",
      confidence: 0.25,
    })

    const report = await doctor(tmp.path, { scope: "project", now })

    expect(report.status).toBe("warn")
    expect(report.issues.map((issue) => issue.code).sort()).toEqual(["expired_entry", "low_confidence"])
    expect(report.summary).toEqual({
      total: 2,
      warnings: 2,
      errors: 0,
      byCode: { expired_entry: 1, low_confidence: 1 },
    })
  })

  test("detects duplicate content across differently named entries", async () => {
    await using tmp = await tmpdir()

    await recordEntry(tmp.path, "feedback", {
      name: "db-tests",
      body: "Prefer real database integration tests",
    })
    await recordEntry(tmp.path, "feedback", {
      name: "integration-tests",
      body: " prefer   real database integration tests ",
    })

    const report = await doctor(tmp.path, { scope: "project" })

    expect(report.status).toBe("warn")
    expect(report.issues).toMatchObject([
      {
        code: "duplicate_content",
        kind: "feedback",
        entryName: "integration-tests",
      },
    ])
  })

  test("detects manually corrupted metadata without rewriting the file", async () => {
    await using tmp = await tmpdir()
    const memory = minimalMemory(tmp.path)
    memory.sections.feedback = {
      tokens: 1,
      entries: [
        {
          name: "dup",
          body: "first",
          savedAt: "2026-01-01T00:00:00.000Z",
          confidence: 2,
          expiresAt: "not-a-date",
          tags: ["memory", ""],
        } as any,
        {
          name: "dup",
          body: "second",
          savedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }
    memory.sections.config = {
      content: "config",
      tokens: 1,
      scannedAt: "2025-01-01T00:00:00.000Z",
    }
    await store.save(tmp.path, memory)

    const report = await doctor(tmp.path, { scope: "project", now: new Date("2026-02-01T00:00:00.000Z") })

    expect(report.status).toBe("error")
    expect(report.summary.errors).toBe(2)
    expect(report.summary.warnings).toBe(3)
    expect(report.issues.map((issue) => issue.code).sort()).toEqual([
      "blank_scope_value",
      "duplicate_entry",
      "invalid_confidence",
      "invalid_expires_at",
      "stale_scan",
    ])
  })

  test("reports load failure for corrupt project JSON", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(`${tmp.path}/.ax-code`, { recursive: true })
    await Bun.write(`${tmp.path}/.ax-code/memory.json`, '{"truncated":')

    const report = await doctor(tmp.path, { scope: "project" })

    expect(report.status).toBe("error")
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0]?.code).toBe("load_failed")
  })
})

function minimalMemory(projectRoot: string): ProjectMemory {
  return {
    version: 1,
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    projectRoot,
    contentHash: "",
    maxTokens: 4000,
    sections: {},
    totalTokens: 0,
  }
}
