import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { transformSync } from "esbuild"
import {
  loadRevertHistory,
  mergeRevertHistory,
  MissingRevertMessageError,
} from "../../../src/cli/cmd/tui/routes/session/revert-history"
import { undoMessageID, redoMessageID } from "../../../src/cli/cmd/tui/routes/session/messages"
import { hiddenMessageIDs, visibleParts } from "../../../src/cli/cmd/tui/routes/session/revert"

const history = Array.from({ length: 350 }, (_, index) => ({
  info: { id: `msg_${String(index).padStart(4, "0")}`, role: index % 2 ? "assistant" : "user" },
  parts: [{ text: `中文 ${index}\r\n` }],
}))
function pager(items = history) {
  const requests: Array<string | undefined> = []
  return {
    requests,
    async fetchPage(before?: string) {
      requests.push(before)
      const end = before ? Number(before) : items.length
      const start = Math.max(0, end - 100)
      return {
        data: items.slice(start, end),
        response: new Response(null, { headers: start ? { "X-Next-Cursor": String(start) } : {} }),
      }
    },
  }
}

describe("recover undo history", () => {
  test.each(["cleared", "changed", "missing", "offline", "navigation"])(
    "missing boundary revalidates authoritative session: %s",
    async (scenario) => {
      const source = readFileSync(new URL("../../../src/cli/cmd/tui/routes/session/index.tsx", import.meta.url), "utf8")
      const start = source.indexOf("  const [historyLoading,")
      const end = source.indexOf("  onCleanup(() => historyFlight?.controller.abort())", start)
      const body = transformSync(source.slice(start, end), { loader: "ts", target: "node26" }).code
      const route = { sessionID: "session" }
      const state = {
        session: [
          { id: "session", revert: { messageID: "deleted" } } as { id: string; revert?: { messageID: string } },
        ],
        message: { session: [history[0].info] },
        part: {},
        message_truncated: { session: false },
      }
      let gets = 0
      const deps = {
        createSignal: (value: unknown) => [
          () => value,
          (next: unknown) => {
            value = next
          },
        ],
        route,
        session: () => state.session[0],
        messages: () => state.message.session,
        sync: { data: state, set: (fn: (store: typeof state) => void) => fn(state) },
        produce: (fn: unknown) => fn,
        sdk: {
          client: {
            session: {
              messages: async () => ({ data: history.slice(0, 1), response: new Response() }),
              get: async () => {
                gets++
                if (scenario === "offline") throw new Error("offline")
                if (scenario === "navigation") route.sessionID = "another"
                return {
                  data:
                    scenario === "missing"
                      ? state.session[0]
                      : scenario === "changed"
                        ? { id: "session", revert: { messageID: "other" } }
                        : { id: "session" },
                }
              },
            },
          },
        },
        undoMessageID,
        loadRevertHistory,
        mergeRevertHistory,
        MissingRevertMessageError,
        MAX_SESSION_MESSAGES: 100,
        sdkErrorMessage: String,
      }
      const loader = new Function(
        ...Object.keys(deps),
        body + ";return {ensureRevertHistory, historyLoading, historyError}",
      )(...Object.values(deps))
      expect(await loader.ensureRevertHistory()).toBe(false)
      expect(gets).toBe(1)
      expect(loader.historyLoading()).toBe(false)
      expect(state.message.session).toEqual([history[0].info])
      if (scenario === "missing") expect(loader.historyError()).toContain("Restore all")
      else if (scenario === "offline") expect(loader.historyError()).toContain("offline")
      else expect(loader.historyError()).toBe("")
      expect(state.session[0].revert?.messageID).toBe(
        scenario === "cleared" ? undefined : scenario === "changed" ? "other" : "deleted",
      )
    },
  )
  test("focused prompt leaves Enter for the open restore confirmation", () => {
    const source = readFileSync(new URL("../../../src/cli/cmd/tui/component/prompt/index.tsx", import.meta.url), "utf8")
    const start = source.indexOf("  useKeyboard((evt) => {")
    const end = source.indexOf("  const fileStyleId", start)
    const body = transformSync(source.slice(start, end), { loader: "ts" }).code
    let handler!: (event: any) => void
    const dialog = { stack: [{}] }
    let submitted = 0
    let consumed = 0
    new Function(
      "useKeyboard",
      "dialog",
      "input",
      "isRenderableAlive",
      "isPromptSubmitKey",
      "log",
      "pasteSubmitGate",
      "autocomplete",
      "submitSafely",
      body,
    )(
      (fn: typeof handler) => {
        handler = fn
      },
      dialog,
      { focused: true },
      () => true,
      () => true,
      { info() {} },
      { deferSubmitUntilPasteHandled: () => false },
      undefined,
      () => submitted++,
    )
    const key = { name: "return", preventDefault: () => consumed++, stopPropagation: () => consumed++ }
    handler(key)
    expect(submitted).toBe(0)
    expect(consumed).toBe(0)
    dialog.stack = []
    handler(key)
    expect(submitted).toBe(1)
    expect(consumed).toBe(2)
  })
  test("Restore confirmation consumes Enter before refocusing the prompt", () => {
    const source = readFileSync(new URL("../../../src/cli/cmd/tui/ui/dialog-confirm.tsx", import.meta.url), "utf8")
    const start = source.indexOf("  useKeyboard((evt) => {")
    const end = source.indexOf("  return (", start)
    const body = transformSync(source.slice(start, end), { loader: "ts" }).code
    let handler!: (event: any) => void
    const events: string[] = []
    new Function("useKeyboard", "store", "props", "runDialogConfirmAction", "dialog", "setStore", body)(
      (fn: typeof handler) => {
        handler = fn
      },
      { active: "confirm" },
      { title: "Restore all", onConfirm: () => events.push("confirm") },
      (fn: () => void) => fn(),
      { clear: () => events.push("clear") },
      () => {},
    )
    handler({
      name: "return",
      preventDefault: () => events.push("prevent"),
      stopPropagation: () => events.push("stop"),
    })
    expect(events).toEqual(["prevent", "stop", "confirm", "clear"])
  })
  test("actual Solid effects automatically start recovery when the session first appears", async () => {
    const solid: typeof import("solid-js") = createRequire(import.meta.url)("solid-js/dist/solid.cjs")
    const source = readFileSync(new URL("../../../src/cli/cmd/tui/routes/session/index.tsx", import.meta.url), "utf8")
    const start = source.indexOf("  const [historyLoading,")
    const end = source.indexOf("  onCleanup(() => historyFlight?.controller.abort())", start)
    const effectStart = source.indexOf('  let historyContextKey = ""')
    const effectEnd = source.indexOf("  const revert = createMemo", effectStart)
    const body = transformSync(source.slice(start, end) + source.slice(effectStart, effectEnd), {
      loader: "ts",
      target: "node26",
    }).code
    const [boundary, setBoundary] = solid.createSignal<string>()
    const [messages, setMessages] = solid.createSignal(history.slice(-100).map((x) => x.info))
    const state = { message: { session: messages() }, part: {}, message_truncated: { session: true } }
    let calls = 0
    let dispose!: () => void
    let loader: any
    solid.createRoot((cleanup) => {
      dispose = cleanup
      const deps = {
        ...solid,
        route: { sessionID: "session" },
        session: () => ({ revert: boundary() ? { messageID: boundary() } : undefined }),
        messages,
        revertMessageID: boundary,
        missingRevertHistory: () => !!boundary() && !messages().some((x) => x.id === boundary()),
        sync: {
          data: state,
          set: (fn: (store: typeof state) => void) => {
            fn(state)
            setMessages(state.message.session)
          },
        },
        produce: (fn: unknown) => fn,
        sdk: {
          client: {
            session: {
              messages: async ({ before }: { before?: string }) => {
                calls++
                return pager().fetchPage(before)
              },
            },
          },
        },
        undoMessageID,
        loadRevertHistory,
        mergeRevertHistory,
        MAX_SESSION_MESSAGES: 100,
        sdkErrorMessage: String,
      }
      loader = new Function(...Object.keys(deps), body + ";return {flight:()=>historyFlight?.promise, historyLoading}")(
        ...Object.values(deps),
      )
    })
    try {
      expect(calls).toBe(0)
      setBoundary(history[48].info.id)
      expect(calls).toBe(1)
      expect(loader.historyLoading()).toBe(true)
      expect(await loader.flight()).toBe(true)
      expect(messages()).toHaveLength(350)
      expect(loader.historyLoading()).toBe(false)
    } finally {
      dispose()
    }
  })
  test("350-message session becomes visible and supports partial redo after paging", async () => {
    const source = pager()
    const boundary = history[48].info.id
    expect(
      hiddenMessageIDs(
        history.slice(-100).map((x) => x.info),
        boundary,
      ).size,
    ).toBe(100)
    const loaded = await loadRevertHistory({
      messageID: boundary,
      signal: new AbortController().signal,
      fetchPage: source.fetchPage,
    })
    const messages = loaded.messages.map((x) => x.info)
    expect(source.requests).toEqual([undefined, "250", "150", "50"])
    expect(loaded.truncated).toBe(false)
    expect(hiddenMessageIDs(messages, boundary).size).toBe(302)
    expect(undoMessageID(messages, boundary)).toBe(history[46].info.id)
    expect(redoMessageID(messages, boundary)).toBe(history[50].info.id)
    expect(redoMessageID(messages, history[348].info.id)).toBeUndefined()
  })
  test("loads the preceding turn when the boundary is the first message of a page", async () => {
    const source = pager()
    const loaded = await loadRevertHistory({
      messageID: history[250].info.id,
      signal: new AbortController().signal,
      fetchPage: source.fetchPage,
    })
    expect(source.requests).toHaveLength(2)
    expect(loaded.truncated).toBe(true)
    expect(
      undoMessageID(
        loaded.messages.map((x) => x.info),
        history[250].info.id,
      ),
    ).toBe(history[248].info.id)
  })
  test("network failure can be retried successfully", async () => {
    const source = pager()
    await expect(
      loadRevertHistory({
        messageID: history[48].info.id,
        signal: new AbortController().signal,
        fetchPage: async () => {
          throw new Error("offline")
        },
      }),
    ).rejects.toThrow("offline")
    await expect(
      loadRevertHistory({
        messageID: history[48].info.id,
        signal: new AbortController().signal,
        fetchPage: source.fetchPage,
      }),
    ).resolves.toHaveProperty("truncated", false)
  })
  test("missing stored boundary terminates with an actionable error", async () => {
    const source = pager()
    await expect(
      loadRevertHistory({ messageID: "missing", signal: new AbortController().signal, fetchPage: source.fetchPage }),
    ).rejects.toThrow("Restore all")
    expect(source.requests).toHaveLength(4)
  })
  test("repeated cursor cannot loop forever", async () => {
    await expect(
      loadRevertHistory({
        messageID: "missing",
        signal: new AbortController().signal,
        fetchPage: async () => ({
          data: history.slice(-1),
          response: new Response(null, { headers: { "X-Next-Cursor": "same" } }),
        }),
      }),
    ).rejects.toThrow("no progress")
  })
  test("leaving a session cancels late page results", async () => {
    const controller = new AbortController()
    await expect(
      loadRevertHistory({
        messageID: history[48].info.id,
        signal: controller.signal,
        fetchPage: async () => {
          controller.abort()
          return pager().fetchPage()
        },
      }),
    ).rejects.toThrow()
  })
  test("merge preserves streamed parts, live tail and avoids duplicates on retry", () => {
    const current = history.slice(-100).map((x) => x.info)
    const live = { id: "msg_0350", role: "assistant" }
    const store = {
      message: { session: [...current, live] },
      part: { [current[0].id]: [{ text: "new streamed text" }] },
    }
    mergeRevertHistory(store, "session", history)
    mergeRevertHistory(store, "session", history)
    expect(store.message.session).toHaveLength(351)
    expect(store.message.session.at(-1)).toEqual(live)
    expect(store.part[current[0].id][0].text).toBe("new streamed text")
    expect(store.part[history[0].info.id]).toEqual(history[0].parts)
  })
  test("actual TUI loader shares concurrent requests and drops results after session navigation", async () => {
    const source = readFileSync(new URL("../../../src/cli/cmd/tui/routes/session/index.tsx", import.meta.url), "utf8")
    const start = source.indexOf("  const [historyLoading,")
    const end = source.indexOf("  onCleanup(() => historyFlight?.controller.abort())", start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const body = transformSync(source.slice(start, end), { loader: "ts", target: "node26" }).code
    const route = { sessionID: "session" }
    const state = {
      message: { session: history.slice(-100).map((x) => x.info) },
      part: {},
      message_truncated: { session: true },
    }
    let release!: () => void
    let calls = 0
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const deps = {
      createSignal: (value: unknown) => [
        () => value,
        (next: unknown) => {
          value = next
        },
      ],
      createEffect: () => {},
      on: () => {},
      route,
      session: () => ({ revert: { messageID: history[48].info.id } }),
      messages: () => state.message.session,
      sync: { data: state, set: (fn: (store: typeof state) => void) => fn(state) },
      produce: (fn: unknown) => fn,
      sdk: {
        client: {
          session: {
            messages: async ({ before }: { before?: string }) => {
              calls++
              await gate
              return pager().fetchPage(before)
            },
          },
        },
      },
      undoMessageID,
      loadRevertHistory,
      mergeRevertHistory,
      MAX_SESSION_MESSAGES: 100,
      sdkErrorMessage: String,
    }
    const loader = new Function(
      ...Object.keys(deps),
      body + ";return {ensureRevertHistory, historyLoading, historyError}",
    )(...Object.values(deps))
    const first = loader.ensureRevertHistory()
    const second = loader.ensureRevertHistory()
    expect(calls).toBe(1)
    expect(loader.historyLoading()).toBe(true)
    route.sessionID = "another-session"
    release()
    expect(await first).toBe(false)
    expect(await second).toBe(false)
    expect(state.message.session).toHaveLength(100)
    expect(loader.historyLoading()).toBe(false)
    route.sessionID = "session"
    expect(await loader.ensureRevertHistory()).toBe(true)
    expect(state.message.session).toHaveLength(350)
    expect(loader.historyError()).toBe("")
  })
})

describe("part-level revert visibility", () => {
  const messages = [
    { id: "user_1", role: "user" },
    { id: "asst_1", role: "assistant" },
    { id: "user_2", role: "user" },
    { id: "asst_2", role: "assistant" },
  ]
  const parts = [{ id: "part_keep" }, { id: "part_hide" }, { id: "part_later" }]

  test("keeps the boundary message visible and hides only later turns", () => {
    expect(hiddenMessageIDs(messages, "asst_1")).toEqual(new Set(["asst_1", "user_2", "asst_2"]))
    expect(hiddenMessageIDs(messages, "asst_1", "part_hide")).toEqual(new Set(["user_2", "asst_2"]))
  })

  test("hides parts at and after the boundary part", () => {
    expect(visibleParts(parts, "part_hide").map((part) => part.id)).toEqual(["part_keep"])
    expect(visibleParts(parts, "missing")).toEqual([])
    expect(visibleParts(parts).map((part) => part.id)).toEqual(["part_keep", "part_hide", "part_later"])
  })
})
