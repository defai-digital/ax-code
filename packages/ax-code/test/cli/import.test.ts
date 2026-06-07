import { test, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { CompatibilityImport } from "../../src/import/compatibility"
import {
  formatCompatibilityImportReport,
  parseShareUrl,
  shouldAttachShareAuthHeaders,
  transformShareData,
  type ShareData,
} from "../../src/cli/cmd/import"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

// parseShareUrl tests
test("parses valid share URLs", () => {
  expect(parseShareUrl("https://opncd.ai/share/Jsj3hNIW")).toBe("Jsj3hNIW")
  expect(parseShareUrl("https://custom.example.com/share/abc123")).toBe("abc123")
  expect(parseShareUrl("http://localhost:3000/share/test_id-123")).toBe("test_id-123")
})

test("rejects invalid URLs", () => {
  expect(parseShareUrl("https://opncd.ai/s/Jsj3hNIW")).toBeNull() // legacy format
  expect(parseShareUrl("https://opncd.ai/share/")).toBeNull()
  expect(parseShareUrl("https://opncd.ai/share/id/extra")).toBeNull()
  expect(parseShareUrl("not-a-url")).toBeNull()
})

test("only attaches share auth headers for same-origin URLs", () => {
  expect(shouldAttachShareAuthHeaders("https://control.example.com/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("https://other.example.com/share/abc", "https://control.example.com")).toBe(false)
  expect(shouldAttachShareAuthHeaders("https://control.example.com:443/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("not-a-url", "https://control.example.com")).toBe(false)
})

// transformShareData tests
test("transforms share data to storage format", () => {
  const data: ShareData[] = [
    { type: "session", data: { id: "sess-1", title: "Test" } as any },
    { type: "message", data: { id: "msg-1", sessionID: "sess-1" } as any },
    { type: "part", data: { id: "part-1", messageID: "msg-1" } as any },
    { type: "part", data: { id: "part-2", messageID: "msg-1" } as any },
    {
      type: "event",
      data: {
        id: "event_1",
        sequence: 3,
        timeCreated: 123,
        event: {
          type: "agent.route",
          sessionID: "sess-1",
          messageID: "msg-1",
          fromAgent: "build",
          toAgent: "perf",
          confidence: 0.9,
          routeMode: "delegate",
          matched: ["performance"],
        },
      },
    },
  ]

  const result = transformShareData(data)!

  expect(result.info.id).toBe("sess-1")
  expect(result.messages).toHaveLength(1)
  expect(result.messages[0].parts).toHaveLength(2)
  expect(result.events).toEqual([
    {
      id: "event_1",
      sequence: 3,
      timeCreated: 123,
      event: {
        type: "agent.route",
        sessionID: "sess-1",
        messageID: "msg-1",
        fromAgent: "build",
        toAgent: "perf",
        confidence: 0.9,
        routeMode: "delegate",
        matched: ["performance"],
      },
    },
  ])
})

test("returns null for invalid share data", () => {
  expect(transformShareData([])).toBeNull()
  expect(transformShareData([{ type: "message", data: {} as any }])).toBeNull()
  expect(transformShareData([{ type: "session", data: { id: "s" } as any }])).toBeNull() // no messages
})

test("compatibility import dry-run reports candidates without writing", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const commandDir = path.join(dir, ".opencode", "commands")
      const skillDir = path.join(dir, ".opencode", "skills", "release-notes")
      await fs.mkdir(commandDir, { recursive: true })
      await fs.mkdir(skillDir, { recursive: true })
      await Filesystem.write(
        path.join(commandDir, "snapshot.md"),
        `---
description: Snapshot
---
Snapshot
!` + "`echo should-not-run`" + `
`,
      )
      await Filesystem.write(
        path.join(skillDir, "SKILL.md"),
        `---
name: release-notes
description: Draft release notes.
---
`,
      )
    },
  })

  const report = await CompatibilityImport.run({ source: "opencode", directory: tmp.path, write: false })

  expect(report.dryRun).toBe(true)
  expect(report.total).toBe(2)
  expect(report.copy).toBe(2)
  expect(report.candidates.map((candidate) => candidate.kind).sort()).toEqual(["command", "skill"])
  expect(report.candidates.find((candidate) => candidate.kind === "command")?.warnings).toContain(
    "unsupported_shell_interpolation",
  )
  expect(await Filesystem.exists(path.join(tmp.path, ".ax-code", "commands", "snapshot.md"))).toBe(false)
  expect(formatCompatibilityImportReport(report)).toContain("Import opencode: dry-run")
})

test("compatibility import writes copies without overwriting existing targets", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const commandDir = path.join(dir, ".claude", "commands")
      await fs.mkdir(commandDir, { recursive: true })
      await Filesystem.write(path.join(commandDir, "review.md"), "Review source")
      await Filesystem.write(path.join(dir, ".ax-code", "commands", "review.md"), "Existing target")
    },
  })

  const report = await CompatibilityImport.run({ source: "claude", directory: tmp.path, write: true })

  expect(report.dryRun).toBe(false)
  expect(report.skipped).toBe(1)
  expect(report.candidates[0].reason).toBe("target_exists")
  expect(await Filesystem.readText(path.join(tmp.path, ".ax-code", "commands", "review.md"))).toBe("Existing target")
})
