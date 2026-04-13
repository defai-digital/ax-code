import { afterEach, describe, expect, test, spyOn } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { AuditSemanticCall } from "../../src/audit/semantic-call"
import { AuditQuery } from "../../src/audit/query"
import { LSP } from "../../src/lsp"
import { LspTool } from "../../src/tool/lsp"
import { Flag } from "../../src/flag/flag"
import { MessageID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function setSyncMode(on: boolean) {
  Object.defineProperty(Flag, "AX_CODE_AUDIT_SYNC", {
    value: on,
    configurable: true,
    writable: true,
  })
}

let spies: { mockRestore(): void }[] = []

afterEach(() => {
  for (const s of spies) s.mockRestore()
  spies = []
  setSyncMode(false)
  AuditSemanticCall.flushNow()
})

// Regression coverage for bugs found during the post-S3 bug hunt.

describe("audit bug fixes", () => {
  // Bug #3: LSP-layer exception during tool execute bypassed audit.
  test("lsp tool LSP exception is captured in audit with errorCode", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setSyncMode(true)
        const session = await Session.create({ title: "audit-exc-test" })

        const err = new Error("simulated crash")
        err.name = "LspCrashError"
        spies.push(spyOn(LSP, "workspaceSymbolEnvelope").mockRejectedValue(err))

        const tool = await LspTool.init()
        await expect(
          tool.execute({ operation: "workspaceSymbol", query: "x" }, {
            sessionID: session.id,
            messageID: MessageID.make(""),
            callID: "",
            agent: "build",
            abort: AbortSignal.any([]),
            messages: [],
            metadata: () => {},
            ask: async () => {},
          } as any),
        ).rejects.toThrow("simulated crash")

        const rows = AuditQuery.listRecent(session.id, 10)
        expect(rows.length).toBe(1)
        expect(rows[0].operation).toBe("workspaceSymbol")
        expect(rows[0].error_code).toBe("LspCrashError")
      },
    })
  })

  // Bug #3 (file-ops path variant): envelope-returning LSP op throws.
  test("lsp tool file-op LSP exception also captured in audit", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setSyncMode(true)
        const session = await Session.create({ title: "audit-exc-fileop-test" })

        const err = new Error("doc symbol crash")
        err.name = "DocSymbolError"
        spies.push(spyOn(LSP, "documentSymbolEnvelope").mockRejectedValue(err))
        spies.push(spyOn(LSP, "hasClients").mockResolvedValue(true))
        spies.push(spyOn(LSP, "touchFile").mockResolvedValue(1 as any))

        const file = `${tmp.path}/demo.ts`
        await Bun.write(file, "export const x = 1\n")

        const tool = await LspTool.init()
        await expect(
          tool.execute(
            { operation: "documentSymbol", filePath: file, line: 1, character: 1 },
            {
              sessionID: session.id,
              messageID: MessageID.make(""),
              callID: "",
              agent: "build",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => {},
              ask: async () => {},
            } as any,
          ),
        ).rejects.toThrow("doc symbol crash")

        const rows = AuditQuery.listRecent(session.id, 10)
        expect(rows.length).toBe(1)
        expect(rows[0].operation).toBe("documentSymbol")
        expect(rows[0].error_code).toBe("DocSymbolError")
      },
    })
  })

  // Bug #1: short-lived process in queue mode could lose rows. We
  // can't easily test `process.on('exit')` in a test runner, but we
  // can at least verify the hook is wired up so record() doesn't
  // throw when called in queue mode (regression guard).
  test("queue mode record() wires up exit hook without throwing", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setSyncMode(false)
        const session = await Session.create({ title: "audit-exit-hook-test" })

        // Multiple records should not error or duplicate the hook.
        for (let i = 0; i < 5; i++) {
          AuditSemanticCall.record({
            sessionID: session.id,
            tool: "lsp",
            operation: "hover",
            args: {},
            envelope: {
              data: [],
              source: "lsp",
              completeness: "empty",
              timestamp: Date.now(),
              serverIDs: [],
            },
          })
        }

        expect(AuditSemanticCall.pendingCount()).toBe(5)
        AuditSemanticCall.flushNow()
        expect(AuditSemanticCall.pendingCount()).toBe(0)

        // Process should still have at most one "exit" and one
        // "beforeExit" listener added by our module (other code may
        // add its own; we check that ours doesn't multiply).
        const beforeExit = process.listeners("beforeExit").length
        const onExit = process.listeners("exit").length
        expect(beforeExit).toBeGreaterThanOrEqual(1)
        expect(onExit).toBeGreaterThanOrEqual(1)

        // Record one more — should not register a second hook.
        AuditSemanticCall.record({
          sessionID: session.id,
          tool: "lsp",
          operation: "hover",
          args: {},
          envelope: { data: [], source: "lsp", completeness: "empty", timestamp: Date.now(), serverIDs: [] },
        })
        AuditSemanticCall.flushNow()

        expect(process.listeners("beforeExit").length).toBe(beforeExit)
        expect(process.listeners("exit").length).toBe(onExit)
      },
    })
  })
})
