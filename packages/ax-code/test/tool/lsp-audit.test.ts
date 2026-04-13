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

// Force sync mode so assertions can observe DB state immediately.
Object.defineProperty(Flag, "AX_CODE_AUDIT_SYNC", {
  value: true,
  configurable: true,
  writable: true,
})

afterEach(() => {
  workspaceEnvelopeSpy?.mockRestore()
  workspaceEnvelopeSpy = undefined
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
})
