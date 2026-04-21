import { describe, expect, test } from "bun:test"
import { createSyncContextValue } from "../../../src/cli/cmd/tui/context/sync-result"

describe("tui sync result", () => {
  test("builds the sync facade around store state and injected actions", () => {
    const setStore = Symbol("setStore")
    const sessionSync = (sessionID: string) => sessionID
    const workspaceSync = () => "workspace-sync"
    const bootstrap = () => "bootstrap"

    const store = {
      status: "loading" as const,
      session: [
        { id: "ses_1", time: {} },
        { id: "ses_2", time: { compacting: true } },
      ],
      message: {
        ses_1: [{ id: "msg_1", role: "user", time: {} }],
        ses_2: [{ id: "msg_2", role: "assistant", time: {} }],
      },
      workspaceList: ["repo-a", "repo-b"],
    }

    const result = createSyncContextValue({
      store,
      setStore,
      sessionSync,
      workspaceSync,
      bootstrap,
    })

    expect(result.data).toBe(store)
    expect(result.set).toBe(setStore)
    expect(result.status).toBe("loading")
    expect(result.ready).toBe(false)
    expect(result.session.get("ses_1")).toEqual({ id: "ses_1", time: {} })
    expect(result.session.get("ses_missing")).toBeUndefined()
    expect(result.session.status("ses_1")).toBe("working")
    expect(result.session.status("ses_2")).toBe("compacting")
    expect(result.workspace.get("repo-b")).toBe("repo-b")
    expect(result.workspace.get("repo-missing")).toBeUndefined()
    expect(result.session.sync).toBe(sessionSync)
    expect(result.workspace.sync).toBe(workspaceSync)
    expect(result.bootstrap).toBe(bootstrap)
  })

  test("reflects readiness changes from the live backing store", () => {
    const store = {
      status: "loading" as "loading" | "partial" | "complete",
      session: [],
      message: {},
      workspaceList: [],
    }

    const result = createSyncContextValue({
      store,
      setStore: null,
      sessionSync: () => undefined,
      workspaceSync: () => undefined,
      bootstrap: () => undefined,
    })

    expect(result.ready).toBe(false)
    store.status = "complete"
    expect(result.status).toBe("complete")
    expect(result.ready).toBe(true)
  })
})
