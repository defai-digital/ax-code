import { describe, expect, test } from "bun:test"
import { handleSyncEvent } from "../../../src/cli/cmd/tui/context/sync-event-router"

describe("tui sync event router", () => {
  test("routes request events before falling through to later handlers", () => {
    const calls: string[] = []

    const handled = handleSyncEvent(
      {
        type: "permission.asked",
        properties: {
          id: "perm_1",
          sessionID: "ses_1",
          permission: "shell",
          patterns: [],
          metadata: {},
          always: [],
        },
      },
      {
        request: {
          autonomous: false,
          updatePermission() {
            calls.push("request")
          },
          updateQuestion: () => undefined,
          replyPermission: () => undefined,
          replyQuestion: () => undefined,
          onWarn: () => undefined,
        },
        session: {
          setTodo: () => calls.push("session"),
          setSessionDiff: () => calls.push("session"),
          setSessionStatus: () => calls.push("session"),
          deleteSession: () => calls.push("session"),
          upsertSession: () => calls.push("session"),
          clearSessionSyncState: () => calls.push("session"),
        },
        message: {
          updateMessage: () => calls.push("message"),
          deleteMessage: () => calls.push("message"),
          updatePart: () => calls.push("message"),
          appendPartDelta: () => calls.push("message"),
          deletePart: () => calls.push("message"),
        },
        runtime: {
          syncMcpStatus: () => {
            calls.push("runtime")
          },
          syncLspStatus: () => {
            calls.push("runtime")
          },
          syncDebugEngine: () => {
            calls.push("runtime")
          },
          setVcsBranch: () => calls.push("runtime"),
          onWarn: () => undefined,
        },
        bootstrap: () => {
          calls.push("bootstrap")
        },
        onWarn: () => undefined,
      },
    )

    expect(handled).toBe(true)
    expect(calls).toEqual(["request"])
  })

  test("routes control and runtime events through the top-level router", async () => {
    const calls: string[] = []

    const disposedHandled = handleSyncEvent(
      { type: "server.instance.disposed" },
      {
        request: {
          autonomous: false,
          updatePermission: () => undefined,
          updateQuestion: () => undefined,
          replyPermission: () => undefined,
          replyQuestion: () => undefined,
          onWarn: () => undefined,
        },
        session: {
          setTodo: () => undefined,
          setSessionDiff: () => undefined,
          setSessionStatus: () => undefined,
          deleteSession: () => undefined,
          upsertSession: () => undefined,
          clearSessionSyncState: () => undefined,
        },
        message: {
          updateMessage: () => undefined,
          deleteMessage: () => undefined,
          updatePart: () => undefined,
          appendPartDelta: () => undefined,
          deletePart: () => undefined,
        },
        runtime: {
          syncMcpStatus: () => undefined,
          syncLspStatus: () => undefined,
          syncDebugEngine: () => undefined,
          setVcsBranch: () => undefined,
          onWarn: () => undefined,
        },
        bootstrap: () => {
          calls.push("bootstrap")
        },
        onWarn: () => undefined,
      },
    )

    const runtimeHandled = handleSyncEvent(
      { type: "vcs.branch.updated", properties: { branch: "feature/test" } },
      {
        request: {
          autonomous: false,
          updatePermission: () => undefined,
          updateQuestion: () => undefined,
          replyPermission: () => undefined,
          replyQuestion: () => undefined,
          onWarn: () => undefined,
        },
        session: {
          setTodo: () => undefined,
          setSessionDiff: () => undefined,
          setSessionStatus: () => undefined,
          deleteSession: () => undefined,
          upsertSession: () => undefined,
          clearSessionSyncState: () => undefined,
        },
        message: {
          updateMessage: () => undefined,
          deleteMessage: () => undefined,
          updatePart: () => undefined,
          appendPartDelta: () => undefined,
          deletePart: () => undefined,
        },
        runtime: {
          syncMcpStatus: () => undefined,
          syncLspStatus: () => undefined,
          syncDebugEngine: () => undefined,
          setVcsBranch(branch) {
            calls.push(`runtime:${branch}`)
          },
          onWarn: () => undefined,
        },
        bootstrap: () => undefined,
        onWarn: () => undefined,
      },
    )

    await Promise.resolve()

    expect(disposedHandled).toBe(true)
    expect(runtimeHandled).toBe(true)
    expect(calls).toEqual(["bootstrap", "runtime:feature/test"])
  })

  test("returns false for unknown events", () => {
    const handled = handleSyncEvent({ type: "unknown.event" } as never, {
      request: {
        autonomous: false,
        updatePermission: () => undefined,
        updateQuestion: () => undefined,
        replyPermission: () => undefined,
        replyQuestion: () => undefined,
        onWarn: () => undefined,
      },
      session: {
        setTodo: () => undefined,
        setSessionDiff: () => undefined,
        setSessionStatus: () => undefined,
        deleteSession: () => undefined,
        upsertSession: () => undefined,
        clearSessionSyncState: () => undefined,
      },
      message: {
        updateMessage: () => undefined,
        deleteMessage: () => undefined,
        updatePart: () => undefined,
        appendPartDelta: () => undefined,
        deletePart: () => undefined,
      },
      runtime: {
        syncMcpStatus: () => undefined,
        syncLspStatus: () => undefined,
        syncDebugEngine: () => undefined,
        setVcsBranch: () => undefined,
        onWarn: () => undefined,
      },
      bootstrap: () => undefined,
      onWarn: () => undefined,
    })

    expect(handled).toBe(false)
  })

  test("warns when bootstrap recovery rejects or throws", async () => {
    const warnings: Array<{ label: string; error: unknown }> = []

    const asyncHandled = handleSyncEvent(
      { type: "server.instance.disposed" },
      {
        request: {
          autonomous: false,
          updatePermission: () => undefined,
          updateQuestion: () => undefined,
          replyPermission: () => undefined,
          replyQuestion: () => undefined,
          onWarn: () => undefined,
        },
        session: {
          setTodo: () => undefined,
          setSessionDiff: () => undefined,
          setSessionStatus: () => undefined,
          deleteSession: () => undefined,
          upsertSession: () => undefined,
          clearSessionSyncState: () => undefined,
        },
        message: {
          updateMessage: () => undefined,
          deleteMessage: () => undefined,
          updatePart: () => undefined,
          appendPartDelta: () => undefined,
          deletePart: () => undefined,
        },
        runtime: {
          syncMcpStatus: () => undefined,
          syncLspStatus: () => undefined,
          syncDebugEngine: () => undefined,
          setVcsBranch: () => undefined,
          onWarn: () => undefined,
        },
        bootstrap: async () => {
          throw new Error("async bootstrap failed")
        },
        onWarn(label, error) {
          warnings.push({ label, error })
        },
      },
    )

    const syncHandled = handleSyncEvent(
      { type: "server.instance.disposed" },
      {
        request: {
          autonomous: false,
          updatePermission: () => undefined,
          updateQuestion: () => undefined,
          replyPermission: () => undefined,
          replyQuestion: () => undefined,
          onWarn: () => undefined,
        },
        session: {
          setTodo: () => undefined,
          setSessionDiff: () => undefined,
          setSessionStatus: () => undefined,
          deleteSession: () => undefined,
          upsertSession: () => undefined,
          clearSessionSyncState: () => undefined,
        },
        message: {
          updateMessage: () => undefined,
          deleteMessage: () => undefined,
          updatePart: () => undefined,
          appendPartDelta: () => undefined,
          deletePart: () => undefined,
        },
        runtime: {
          syncMcpStatus: () => undefined,
          syncLspStatus: () => undefined,
          syncDebugEngine: () => undefined,
          setVcsBranch: () => undefined,
          onWarn: () => undefined,
        },
        bootstrap: () => {
          throw new Error("sync bootstrap failed")
        },
        onWarn(label, error) {
          warnings.push({ label, error })
        },
      },
    )

    await Promise.resolve()

    expect(asyncHandled).toBe(true)
    expect(syncHandled).toBe(true)
    expect(warnings).toHaveLength(2)
    expect(warnings.map((item) => item.label)).toEqual(["bootstrap sync failed", "bootstrap sync failed"])
  })
})
