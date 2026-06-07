import { describe, expect, test } from "bun:test"
import {
  appendFollowUp,
  followUpText,
  headFollowUp,
  isQueueableStatus,
  makeFollowUp,
  removeFollowUp,
  shouldDrainOnIdle,
  type QueuedFollowUp,
} from "../../../src/cli/cmd/tui/component/prompt/follow-up-queue"
import {
  clearFollowUpEdit,
  clearFollowUpQueue,
  dispatchFollowUp,
  enqueueFollowUp,
  followUpEditRequest,
  followUpQueue,
  forgetFollowUpSession,
  hasRecentFollowUpAbort,
  markFollowUpAbort,
  peekQueuedFollowUp,
  reconcileFollowUpDrain,
  removeQueuedFollowUp,
  requestFollowUpEdit,
  resetFollowUpDrainState,
} from "../../../src/cli/cmd/tui/component/prompt/follow-up-queue-store"

const item = (id: string, text = "hi"): QueuedFollowUp =>
  makeFollowUp({ parts: [{ id: "p", type: "text", text }] }, id, 1)

describe("follow-up-queue (pure)", () => {
  test("makeFollowUp carries input and stamps id/createdAt", () => {
    const made = makeFollowUp({ parts: [{ type: "text", text: "x" }], agent: "build" }, "a", 42)
    expect(made).toEqual({ parts: [{ type: "text", text: "x" }], agent: "build", id: "a", createdAt: 42 })
  })

  test("appendFollowUp appends in order and tolerates undefined", () => {
    const a = appendFollowUp(undefined, item("1"))
    const b = appendFollowUp(a, item("2"))
    expect(b.map((i) => i.id)).toEqual(["1", "2"])
  })

  test("removeFollowUp drops by id and tolerates undefined", () => {
    expect(removeFollowUp(undefined, "x")).toEqual([])
    const list = [item("1"), item("2"), item("3")]
    expect(removeFollowUp(list, "2").map((i) => i.id)).toEqual(["1", "3"])
  })

  test("headFollowUp returns first or undefined", () => {
    expect(headFollowUp(undefined)).toBeUndefined()
    expect(headFollowUp([])).toBeUndefined()
    expect(headFollowUp([item("1"), item("2")])?.id).toBe("1")
  })

  test("isQueueableStatus is true only while busy/retry", () => {
    expect(isQueueableStatus("busy")).toBe(true)
    expect(isQueueableStatus("retry")).toBe(true)
    expect(isQueueableStatus("idle")).toBe(false)
    expect(isQueueableStatus(undefined)).toBe(false)
  })

  test("shouldDrainOnIdle fires only on busy/retry -> idle", () => {
    expect(shouldDrainOnIdle("busy", "idle")).toBe(true)
    expect(shouldDrainOnIdle("retry", "idle")).toBe(true)
    expect(shouldDrainOnIdle("idle", "idle")).toBe(false)
    expect(shouldDrainOnIdle("busy", "busy")).toBe(false)
    expect(shouldDrainOnIdle("busy", "retry")).toBe(false)
    expect(shouldDrainOnIdle(undefined, "idle")).toBe(false)
  })

  test("followUpText returns first non-empty text", () => {
    expect(followUpText(item("1", "  hello  "))).toBe("hello")
    expect(followUpText(makeFollowUp({ parts: [{ type: "file" }, { type: "text", text: " y " }] }, "1", 1))).toBe("y")
    expect(followUpText(makeFollowUp({ parts: [{ type: "file" }] }, "1", 1))).toBe("")
  })
})

describe("follow-up-queue-store", () => {
  test("enqueue/peek/remove/clear are per-session and ordered", () => {
    const sid = "ses_store_basic"
    clearFollowUpQueue(sid)
    const a = enqueueFollowUp(sid, { parts: [{ type: "text", text: "one" }] })
    const b = enqueueFollowUp(sid, { parts: [{ type: "text", text: "two" }] })
    expect(followUpQueue(sid).map((i) => i.id)).toEqual([a.id, b.id])
    expect(peekQueuedFollowUp(sid)?.id).toBe(a.id)

    removeQueuedFollowUp(sid, a.id)
    expect(followUpQueue(sid).map((i) => i.id)).toEqual([b.id])

    clearFollowUpQueue(sid)
    expect(followUpQueue(sid)).toEqual([])
    // Other sessions are unaffected.
    expect(followUpQueue("ses_other")).toEqual([])
  })

  test("recent-abort window suppresses draining", () => {
    const sid = "ses_abort"
    const now = 10_000
    expect(hasRecentFollowUpAbort(sid, now)).toBe(false)
    markFollowUpAbort(sid, now)
    expect(hasRecentFollowUpAbort(sid, now + 1500)).toBe(true)
    expect(hasRecentFollowUpAbort(sid, now + 2500)).toBe(false)
  })

  test("dispatchFollowUp posts the captured payload and resolves true", async () => {
    const sid = "ses_dispatch_ok"
    const calls: any[] = []
    const sdk = {
      client: { session: { promptAsync: async (args: any) => (calls.push(args), {}) } },
    } as any
    const queued = enqueueFollowUp(sid, {
      parts: [{ id: "p1", type: "text", text: "go" }],
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude" },
      variant: "fast",
    })
    const ok = await dispatchFollowUp(sdk, sid, queued)
    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      sessionID: sid,
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude" },
      variant: "fast",
      parts: [{ id: "p1", type: "text", text: "go" }],
    })
    expect(typeof calls[0].messageID).toBe("string")
    // Removal happens inside dispatch (while the in-flight guard is held) so no
    // other caller can re-dispatch the same head.
    expect(followUpQueue(sid)).toEqual([])
    clearFollowUpQueue(sid)
  })

  test("dispatchFollowUp throws on a server error result (so callers can surface it)", async () => {
    const sdk = { client: { session: { promptAsync: async () => ({ error: { data: { message: "boom" } } }) } } } as any
    expect(dispatchFollowUp(sdk, "ses_err", item("1"))).rejects.toThrow("boom")
  })

  test("edit channel carries a pending request (with item id) and clears", () => {
    clearFollowUpEdit()
    expect(followUpEditRequest()).toBeUndefined()
    requestFollowUpEdit("ses_edit", "followup-1", "revise me")
    expect(followUpEditRequest()).toEqual({ sessionID: "ses_edit", id: "followup-1", text: "revise me" })
    clearFollowUpEdit()
    expect(followUpEditRequest()).toBeUndefined()
  })

  test("forgetFollowUpSession clears queue, baseline, and abort marks", () => {
    const sid = "ses_forget"
    enqueueFollowUp(sid, { parts: [{ type: "text", text: "x" }] })
    markFollowUpAbort(sid)
    expect(followUpQueue(sid).length).toBe(1)
    forgetFollowUpSession(sid)
    expect(followUpQueue(sid)).toEqual([])
    expect(hasRecentFollowUpAbort(sid)).toBe(false)
  })

  test("dispatchFollowUp skips a concurrent dispatch for the same session", async () => {
    const sid = "ses_inflight"
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const sdk = { client: { session: { promptAsync: async () => (await gate, {}) } } } as any

    const first = dispatchFollowUp(sdk, sid, item("1"))
    const second = await dispatchFollowUp(sdk, sid, item("2"))
    expect(second).toBe(false)
    release?.()
    expect(await first).toBe(true)
  })
})

describe("reconcileFollowUpDrain", () => {
  const fakeSdk = (calls: any[]) =>
    ({ client: { session: { promptAsync: async (args: any) => (calls.push(args), {}) } } }) as any

  test("dispatches the head only on a busy -> idle transition, once", () => {
    resetFollowUpDrainState()
    const sid = "ses_drain"
    clearFollowUpQueue(sid)
    enqueueFollowUp(sid, { parts: [{ type: "text", text: "next" }] })
    const calls: any[] = []
    const sdk = fakeSdk(calls)

    // First observation only establishes a baseline — no drain.
    reconcileFollowUpDrain(sdk, [[sid, "busy"]])
    expect(calls).toHaveLength(0)

    // busy -> idle drains the head.
    reconcileFollowUpDrain(sdk, [[sid, "idle"]])
    expect(calls).toHaveLength(1)
    expect(calls[0].sessionID).toBe(sid)
    clearFollowUpQueue(sid)
  })

  test("does not drain on idle -> idle or when there is no queued item", () => {
    resetFollowUpDrainState()
    const sid = "ses_drain_none"
    clearFollowUpQueue(sid)
    const calls: any[] = []
    const sdk = fakeSdk(calls)
    reconcileFollowUpDrain(sdk, [[sid, "busy"]])
    reconcileFollowUpDrain(sdk, [[sid, "idle"]]) // no queued item
    expect(calls).toHaveLength(0)
  })

  test("a recent abort suppresses the drain on that transition", () => {
    resetFollowUpDrainState()
    const sid = "ses_drain_abort"
    clearFollowUpQueue(sid)
    enqueueFollowUp(sid, { parts: [{ type: "text", text: "x" }] })
    const calls: any[] = []
    const sdk = fakeSdk(calls)
    reconcileFollowUpDrain(sdk, [[sid, "busy"]])
    markFollowUpAbort(sid)
    reconcileFollowUpDrain(sdk, [[sid, "idle"]])
    expect(calls).toHaveLength(0)
    clearFollowUpQueue(sid)
  })

  test("does not dispatch (or strand) the head while another dispatch is in flight", async () => {
    resetFollowUpDrainState()
    const sid = "ses_drain_inflight"
    clearFollowUpQueue(sid)
    enqueueFollowUp(sid, { parts: [{ type: "text", text: "head" }] })

    // A manual send grabs the per-session in-flight guard.
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const gatedSdk = { client: { session: { promptAsync: async () => (await gate, {}) } } } as any
    const manual = dispatchFollowUp(gatedSdk, sid, peekQueuedFollowUp(sid)!)

    // The auto-drain edge arrives while the manual dispatch is in flight: it must
    // not dispatch again (no double-send).
    const calls: any[] = []
    const drainSdk = fakeSdk(calls)
    reconcileFollowUpDrain(drainSdk, [[sid, "busy"]])
    reconcileFollowUpDrain(drainSdk, [[sid, "idle"]])
    expect(calls).toHaveLength(0)

    release?.()
    expect(await manual).toBe(true)
    // The manual dispatch removed the head on success — nothing stranded.
    expect(followUpQueue(sid)).toEqual([])
    clearFollowUpQueue(sid)
  })

  test("shared baseline dedupes repeated reconcile calls for the same transition", () => {
    resetFollowUpDrainState()
    const sid = "ses_drain_dedupe"
    clearFollowUpQueue(sid)
    enqueueFollowUp(sid, { parts: [{ type: "text", text: "y" }] })
    const calls: any[] = []
    const sdk = fakeSdk(calls)
    reconcileFollowUpDrain(sdk, [[sid, "busy"]])
    reconcileFollowUpDrain(sdk, [[sid, "idle"]]) // drains
    reconcileFollowUpDrain(sdk, [[sid, "idle"]]) // same baseline now idle -> no second drain
    expect(calls).toHaveLength(1)
    clearFollowUpQueue(sid)
  })
})
