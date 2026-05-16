import { afterEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { LspTool } from "../../src/tool/lsp"
import { AuditQuery } from "../../src/audit/query"
import { AuditSemanticCall } from "../../src/audit/semantic-call"
import { Flag } from "../../src/flag/flag"
import { SessionID, MessageID } from "../../src/session/schema"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

let workspaceEnvelopeSpy: ReturnType<typeof spyOn> | undefined
let diagnosticsAggregatedSpy: ReturnType<typeof spyOn> | undefined
let hasClientsSpy: ReturnType<typeof spyOn> | undefined
let touchFileSpy: ReturnType<typeof spyOn> | undefined
let incomingCallsEnvelopeSpy: ReturnType<typeof spyOn> | undefined

// Force sync mode so assertions can observe DB state immediately.
Object.defineProperty(Flag, "AX_CODE_AUDIT_SYNC", {
  value: true,
  configurable: true,
  writable: true,
})

afterEach(() => {
  workspaceEnvelopeSpy?.mockRestore()
  diagnosticsAggregatedSpy?.mockRestore()
  hasClientsSpy?.mockRestore()
  touchFileSpy?.mockRestore()
  incomingCallsEnvelopeSpy?.mockRestore()
  workspaceEnvelopeSpy = undefined
  diagnosticsAggregatedSpy = undefined
  hasClientsSpy = undefined
  touchFileSpy = undefined
  incomingCallsEnvelopeSpy = undefined
  AuditSemanticCall.flushNow()
})

describe("lsp tool audit trail (S3)", () => {
  test("successful workspaceSymbol writes an audit row with the full envelope", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "audit-tool-test" })

        workspaceEnvelopeSpy = spyOn(LSP, "workspaceSymbolEnvelope").mockResolvedValue({
          symbols: [
            {
              name: "DemoSymbol",
              kind: 12,
              location: {
                uri: "file:///workspace/demo.ts",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
              },
            },
          ],
          source: "lsp",
          completeness: "full",
          timestamp: 1_700_000_000_000,
          serverIDs: ["typescript"],
        } as any)

        const tool = await LspTool.init()
        await tool.execute({ operation: "workspaceSymbol", query: "DemoSymbol" }, {
          sessionID: session.id,
          messageID: MessageID.make(""),
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => {},
          ask: async () => {},
        } as any)

        AuditSemanticCall.flushNow()

        const rows = AuditQuery.listRecent(session.id, 10)
        expect(rows.length).toBe(1)
        expect(rows[0].tool).toBe("lsp")
        expect(rows[0].operation).toBe("workspaceSymbol")
        expect(rows[0].error_code).toBeNull()
        const envelope = rows[0].envelope_json as { source: string; completeness: string; serverIDs: string[] }
        expect(envelope.source).toBe("lsp")
        expect(envelope.completeness).toBe("full")
        expect(envelope.serverIDs).toEqual(["typescript"])
      },
    })
  })

  test("missing query writes an audit row with errorCode=MissingQuery and throws", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "audit-err-test" })
        const tool = await LspTool.init()

        await expect(
          tool.execute({ operation: "workspaceSymbol", query: "" }, {
            sessionID: session.id,
            messageID: MessageID.make(""),
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          } as any),
        ).rejects.toThrow("requires `query`")

        AuditSemanticCall.flushNow()

        const rows = AuditQuery.listRecent(session.id, 10)
        expect(rows.length).toBe(1)
        expect(rows[0].operation).toBe("workspaceSymbol")
        expect(rows[0].error_code).toBe("MissingQuery")
      },
    })
  })

  test("missing filePath for file-op writes audit row with errorCode=MissingFilePath", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "audit-missing-test" })
        const tool = await LspTool.init()

        await expect(
          tool.execute({ operation: "hover" }, {
            sessionID: session.id,
            messageID: MessageID.make(""),
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          } as any),
        ).rejects.toThrow("requires `filePath`")

        AuditSemanticCall.flushNow()

        const rows = AuditQuery.listRecent(session.id, 10)
        expect(rows.length).toBe(1)
        expect(rows[0].error_code).toBe("MissingFilePath")
      },
    })
  })

  test("diagnosticsAggregated writes an audit row with the aggregated envelope", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "audit-diag-test" })
        hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
        touchFileSpy = spyOn(LSP, "touchFile").mockResolvedValue(1 as any)
        diagnosticsAggregatedSpy = spyOn(LSP, "diagnosticsAggregated").mockResolvedValue({
          data: [
            {
              path: file,
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: "warning",
              message: "unused value",
              serverIDs: ["typescript", "eslint"],
            },
          ],
          source: "lsp",
          completeness: "full",
          timestamp: 1_700_000_000_000,
          serverIDs: ["typescript", "eslint"],
          degraded: false,
        } as any)

        const tool = await LspTool.init()
        await tool.execute({ operation: "diagnosticsAggregated", filePath: file }, {
          sessionID: session.id,
          messageID: MessageID.make(""),
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => {},
          ask: async () => {},
        } as any)

        AuditSemanticCall.flushNow()

        const rows = AuditQuery.listRecent(session.id, 10)
        expect(rows.length).toBe(1)
        expect(rows[0].operation).toBe("diagnosticsAggregated")
        expect(rows[0].error_code).toBeNull()
        const envelope = rows[0].envelope_json as { source: string; serverIDs: string[]; data: unknown[] }
        expect(envelope.source).toBe("lsp")
        expect(envelope.serverIDs.sort()).toEqual(["eslint", "typescript"])
        expect(envelope.data).toHaveLength(1)
      },
    })
  })

  test("incomingCalls writes an audit row with a real LSP envelope", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "audit-incoming-calls-test" })
        hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
        touchFileSpy = spyOn(LSP, "touchFile").mockResolvedValue(1 as any)
        incomingCallsEnvelopeSpy = spyOn(LSP, "incomingCallsEnvelope").mockResolvedValue({
          data: [{ from: "caller" }],
          source: "lsp",
          completeness: "full",
          timestamp: 1_700_000_000_001,
          serverIDs: ["typescript"],
          degraded: false,
        } as any)

        const tool = await LspTool.init()
        await tool.execute({ operation: "incomingCalls", filePath: file, line: 1, character: 1 }, {
          sessionID: session.id,
          messageID: MessageID.make(""),
          callID: "",
          agent: "build",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => {},
          ask: async () => {},
        } as any)

        AuditSemanticCall.flushNow()

        const rows = AuditQuery.listRecent(session.id, 10)
        expect(rows.length).toBe(1)
        expect(rows[0].operation).toBe("incomingCalls")
        const envelope = rows[0].envelope_json as { source: string; serverIDs: string[]; completeness: string }
        expect(envelope.source).toBe("lsp")
        expect(envelope.completeness).toBe("full")
        expect(envelope.serverIDs).toEqual(["typescript"])
      },
    })
  })
})
