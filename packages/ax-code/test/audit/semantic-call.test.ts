import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { AuditSemanticCall } from "../../src/audit/semantic-call"
import { AuditQuery } from "../../src/audit/query"
import { Flag } from "../../src/flag/flag"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function setSyncMode(on: boolean) {
  Object.defineProperty(Flag, "AX_CODE_AUDIT_SYNC", {
    value: on,
    configurable: true,
    writable: true,
  })
}

const originalSync = Flag.AX_CODE_AUDIT_SYNC

afterEach(() => {
  setSyncMode(originalSync)
  AuditSemanticCall.flushNow()
})

describe("AuditSemanticCall (queue mode)", () => {
  test("record() returns immediately and persists after flush", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setSyncMode(false)
        const session = await Session.create({ title: "audit-queue-test" })

        const id = AuditSemanticCall.record({
          sessionID: session.id,
          tool: "lsp",
          operation: "references",
          args: { filePath: "/tmp/a.ts", line: 1, character: 1 },
          envelope: {
            data: [],
            source: "lsp",
            completeness: "empty",
            timestamp: Date.now(),
            serverIDs: [],
          },
        })

        // In queue mode the row is not yet in the DB — pending count
        // is 1, DB lookup returns undefined.
        expect(AuditSemanticCall.pendingCount()).toBe(1)
        expect(AuditQuery.getById(id)).toBeUndefined()

        // Drain the queue explicitly (production does this on tick
        // boundary; tests do it synchronously to observe).
        AuditSemanticCall.flushNow()

        expect(AuditSemanticCall.pendingCount()).toBe(0)
        const row = AuditQuery.getById(id)
        expect(row).toBeDefined()
        expect(row!.tool).toBe("lsp")
        expect(row!.operation).toBe("references")
      },
    })
  })

  test("multiple records batch into a single flush", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setSyncMode(false)
        const session = await Session.create({ title: "audit-batch-test" })

        const mkEnv = (op: string) => ({
          data: [],
          source: "lsp" as const,
          completeness: "empty" as const,
          timestamp: Date.now(),
          serverIDs: [],
          op,
        })

        const ids = [
          AuditSemanticCall.record({
            sessionID: session.id,
            tool: "lsp",
            operation: "a",
            args: {},
            envelope: mkEnv("a"),
          }),
          AuditSemanticCall.record({
            sessionID: session.id,
            tool: "lsp",
            operation: "b",
            args: {},
            envelope: mkEnv("b"),
          }),
          AuditSemanticCall.record({
            sessionID: session.id,
            tool: "lsp",
            operation: "c",
            args: {},
            envelope: mkEnv("c"),
          }),
        ]

        expect(AuditSemanticCall.pendingCount()).toBe(3)
        AuditSemanticCall.flushNow()
        expect(AuditSemanticCall.pendingCount()).toBe(0)

        for (const id of ids) {
          expect(AuditQuery.getById(id)).toBeDefined()
        }
      },
    })
  })
})

describe("AuditSemanticCall (sync mode)", () => {
  test("record() blocks on DB write; row is durable before return", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setSyncMode(true)
        const session = await Session.create({ title: "audit-sync-test" })

        const id = AuditSemanticCall.record({
          sessionID: session.id,
          tool: "lsp",
          operation: "hover",
          args: { filePath: "/tmp/x.ts", line: 1, character: 1 },
          envelope: {
            data: [],
            source: "lsp",
            completeness: "empty",
            timestamp: Date.now(),
            serverIDs: [],
          },
        })

        // Sync mode: the row must be in the DB immediately, without
        // calling flushNow(). Queue is also empty.
        expect(AuditSemanticCall.pendingCount()).toBe(0)
        const row = AuditQuery.getById(id)
        expect(row).toBeDefined()
        expect(row!.operation).toBe("hover")
      },
    })
  })
})

describe("AuditSemanticCall error_code", () => {
  test("errorCode is persisted for failed calls", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setSyncMode(true)
        const session = await Session.create({ title: "audit-err-test" })

        const id = AuditSemanticCall.record({
          sessionID: session.id,
          tool: "lsp",
          operation: "references",
          args: { filePath: "/nope.ts", line: 1, character: 1 },
          envelope: {
            data: [],
            source: "lsp",
            completeness: "empty",
            timestamp: Date.now(),
            serverIDs: [],
          },
          errorCode: "FileNotFound",
        })

        const row = AuditQuery.getById(id)
        expect(row!.error_code).toBe("FileNotFound")
      },
    })
  })
})

describe("AuditQuery.listRecent", () => {
  test("returns rows for the given session in descending time order", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setSyncMode(true)
        const session = await Session.create({ title: "audit-list-test" })

        const envelope = {
          data: [],
          source: "lsp" as const,
          completeness: "empty" as const,
          timestamp: Date.now(),
          serverIDs: [],
        }

        for (const op of ["a", "b", "c"]) {
          AuditSemanticCall.record({
            sessionID: session.id,
            tool: "lsp",
            operation: op,
            args: {},
            envelope,
          })
        }

        const rows = AuditQuery.listRecent(session.id, 10)
        expect(rows.length).toBeGreaterThanOrEqual(3)
        expect(rows.map((r) => r.session_id).every((id) => id === session.id)).toBe(true)
      },
    })
  })
})
