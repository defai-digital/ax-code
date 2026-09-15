import { createStore } from "solid-js/store"
import { describe, expect, test } from "vitest"
import {
  durableFollowUps,
  followUpBody,
  followUpStatus,
  mergeFollowUpSnapshot,
} from "../../../src/cli/tui/component/prompt/durable-follow-up"

function row(id: string, status = "queued") {
  return {
    id,
    kind: "followup",
    sessionID: "ses_one",
    status,
    title: id,
    position: 1,
    time: { created: 1, updated: 1 },
    payload: {
      body: {
        parts: [
          { type: "text", text: "Review" },
          { type: "file", url: "data:text/plain,example", mime: "text/plain" },
        ],
        agent: "build",
        model: { providerID: "gateway", modelID: "model" },
        variant: "high",
      },
    },
  }
}

describe("durable follow-up projection", () => {
  test("accepts Solid store payloads without treating internal symbols as JSON fields", () => {
    const item = row("reactive")
    Object.defineProperty(item.payload, Symbol("store-node"), { value: {}, enumerable: true })
    const [state, setState] = createStore({ items: [item] })
    expect(durableFollowUps(state.items, "ses_one").map((item) => item.id)).toEqual(["reactive"])
    setState("items", 0, "status", "paused")
    expect(durableFollowUps(state.items, "ses_one")[0].status).toBe("paused")
  })
  test("history explicitly includes completed and cancelled work", () => {
    expect(durableFollowUps([row("a", "completed"), row("b", "cancelled")], "ses_one", true)).toHaveLength(2)
  })
  test("separates sessions and task kinds while retaining paused and failed work", () => {
    expect(
      durableFollowUps(
        [
          row("a"),
          row("b", "paused"),
          row("c", "failed"),
          row("d", "completed"),
          row("e", "cancelled"),
          { ...row("f"), sessionID: "ses_two" },
          { ...row("g"), kind: "automation" },
          null,
        ],
        "ses_one",
      ).map((item) => item.id),
    ).toEqual(["a", "b", "c"])
  })
  test("keeps prompt attachments and model selection", () => {
    const item = durableFollowUps([row("a")], "ses_one")[0]
    expect(followUpBody(item)).toEqual(item.payload.body)
    expect(
      followUpStatus({
        ...item,
        status: "failed",
        payload: { ...item.payload, interruptionReason: "backend_restart" },
      }),
    ).toBe("Interrupted - inspect before retry")
  })
  test("snapshot removes stale cache without overwriting events received during refresh", () => {
    const original = row("a")
    const stale = row("stale")
    const before = new Map([original, stale].map((item) => [item.id, JSON.stringify(item)]))
    const completed = { ...original, status: "completed", time: { created: 1, updated: 2 } }
    const newEvent = row("new")
    const other = { ...row("other"), sessionID: "ses_two" }
    const merged = mergeFollowUpSnapshot([completed, stale, newEvent, other], [original], "ses_one", before)
    expect(merged.find((item) => item.id === "a")?.status).toBe("completed")
    expect(merged.map((item) => item.id).sort()).toEqual(["a", "new", "other"])
  })
  test("an in-flight snapshot cannot resurrect a deleted task", () => {
    expect(mergeFollowUpSnapshot([], [row("deleted")], "ses_one", new Map(), new Set(["deleted"]))).toEqual([])
  })
})
