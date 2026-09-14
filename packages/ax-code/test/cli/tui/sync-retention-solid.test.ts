import { describe, expect, test } from "vitest"
import { createRequire } from "node:module"

// Exercise the client store proxies used by the TUI, not the Node SSR store.
const { createStore, produce }: typeof import("solid-js/store") = createRequire(import.meta.url)(
  "solid-js/store/dist/store.cjs",
)
import type { Message, Part } from "@ax-code/sdk/v2"
import { createInitialSyncState } from "../../../src/cli/cmd/tui/context/sync-state"
import { applyHeadlessProjectionEvent } from "../../../src/runtime/headless/projection"
import { applySessionLeavePrune } from "../../../src/cli/cmd/tui/context/sync-session-store"
import { retainTranscriptEvent } from "../../../src/cli/cmd/tui/context/sync-transcript-event"

function fixture() {
  const initial = createInitialSyncState()
  const [state, setStore] = createStore(initial)
  const message = (id: string) =>
    setStore(
      produce((draft) => {
        applyHeadlessProjectionEvent(
          draft,
          {
            type: "message.updated",
            properties: {
              info: {
                id,
                sessionID: "session",
                role: "user",
                time: { created: 1 },
                agent: "build",
                model: { providerID: "test", modelID: "test" },
              } satisfies Message,
            },
          },
          { maxSessionMessages: 2 },
        )
      }),
    )
  const part = (id: string, text: string) =>
    setStore(
      produce((draft) => {
        applyHeadlessProjectionEvent(draft, {
          type: "message.part.updated",
          properties: {
            part: {
              id: `part_${id}`,
              messageID: id,
              sessionID: "session",
              type: "text",
              text,
            } satisfies Part,
          },
        })
      }),
    )
  const delta = (id: string, text: string) =>
    setStore(
      produce((draft) => {
        applyHeadlessProjectionEvent(draft, {
          type: "message.part.delta",
          properties: { sessionID: "session", messageID: id, partID: `part_${id}`, field: "text", delta: text },
        })
      }),
    )
  return { initial, state, setStore, message, part, delta }
}

describe("production Solid retention identity", () => {
  test("an absent optional active-session root key becomes live through setStore", () => {
    const f = fixture()
    expect(Object.hasOwn(f.initial, "active_session")).toBe(false)
    f.setStore("active_session", "session")
    expect(f.state.active_session).toBe("session")
    expect(
      retainTranscriptEvent(
        { type: "message.updated", properties: { info: { sessionID: "session" } } },
        f.state.active_session,
      ),
    ).toBe(true)
    f.message("m1")
    f.part("m1", "visible")
    expect(f.state.part.m1[0]).toMatchObject({ text: "visible" })
  })

  test("eviction floors survive separate produce batches", () => {
    const f = fixture()
    f.message("m1")
    f.part("m1", "old")
    f.message("m2")
    f.message("m3")
    f.part("m1", "late compacted snapshot")
    expect(f.state.part.m1).toBeUndefined()
    expect(f.state.message.session.map((item) => item.id)).toEqual(["m2", "m3"])
  })

  test("delta protection survives batches and leave cleanup resets it", () => {
    const f = fixture()
    f.part("m1", "hello")
    f.delta("m1", " world")
    f.part("m1", "hel")
    expect(f.state.part.m1[0]).toMatchObject({ text: "hello world" })
    f.setStore(produce((draft) => applySessionLeavePrune(draft, "session")))
    expect(f.state.part.m1).toBeUndefined()
    f.part("m1", "hello world")
    f.part("m1", "hello")
    expect(f.state.part.m1[0]).toMatchObject({ text: "hello" })
  })

  test("pending count and byte accounting accumulates across produce batches", () => {
    const f = fixture()
    for (let index = 0; index < 150; index++) f.part(`pending_${index}`, "x".repeat(16 * 1024))
    expect(Object.keys(f.state.part).length).toBeLessThanOrEqual(128)
    const bytes = Object.values(f.state.part)
      .flat()
      .reduce((sum, part) => sum + Buffer.byteLength(JSON.stringify(part)), 0)
    expect(bytes).toBeLessThanOrEqual(1024 * 1024)
    expect(f.state.message_reload.session).toBe(true)
  })
})
