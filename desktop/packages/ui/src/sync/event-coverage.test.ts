/**
 * Event → field → store pinning test (SPEC-2026-08-30, S4.2).
 *
 * The "Event → field mapping" table in DOCUMENTATION.md is the contract for
 * which State slices an event type may touch. This suite pins that contract
 * against the real code instead of a copy:
 *
 * (a) For every documented event type, `prepareEventDraft` (the cloning
 *     switch used by `handleEvent`) must clone EXACTLY the documented
 *     slices — no more (breaks referential stability), no less (mutates the
 *     previous state object in place; the deep-frozen baseline would throw).
 * (b) A synthetic burst of `message.part.delta` events through the real
 *     pipeline → reducer → child-store path must leave every untouched slice
 *     (`session`, `permission`, unrelated messages/parts, …)
 *     reference-identical, across the whole burst.
 */

import { describe, expect, test, vi } from "vitest"
import type { Event, Message, Part, Session } from "@ax-code/sdk/v2/client"
import documentation from "./DOCUMENTATION.md?raw"
import { ChildStoreManager } from "./child-store"
import { createEventPipeline } from "./event-pipeline"
import { applyDirectoryEvent, prepareEventDraft } from "./event-reducer"
import { INITIAL_STATE, type State } from "./types"

// ---------------------------------------------------------------------------
// Fixture: the documented event → cloned-slices table (DOCUMENTATION.md,
// "Event → field mapping"). Keep in sync with the doc; the drift guard at the
// bottom of this file compares the fixture keys against the parsed doc table.
// ---------------------------------------------------------------------------

const DOCUMENTED_EVENT_SLICES: Readonly<Record<string, readonly string[]>> = {
  "session.created": ["session", "permission", "todo", "part"],
  "session.updated": ["session", "permission", "todo", "part"],
  "session.deleted": ["session", "permission", "todo", "part"],
  "session.diff": ["session_diff"],
  "session.status": ["session_status"],
  "session.idle": ["session_status"],
  "session.error": ["session_status"],
  "todo.updated": ["todo"],
  "message.updated": ["message"],
  "message.removed": ["message", "part"],
  "message.part.updated": ["part"],
  "message.part.removed": ["part"],
  "message.part.delta": ["part"],
  "vcs.branch.updated": [],
  "permission.asked": ["permission"],
  "permission.replied": ["permission"],
  "question.asked": ["question"],
  "question.replied": ["question"],
  "question.rejected": ["question"],
  "lsp.updated": ["lsp"],
}

/** Extra slices cloned when a session lifecycle event archives or deletes. */
const LIFECYCLE_EXTRA_SLICES = ["message", "session_diff", "session_status", "question"]

/** Slices whose reference identity is asserted. */
const TRACKED_SLICES = [
  "session",
  "message",
  "part",
  "permission",
  "question",
  "todo",
  "session_status",
  "session_diff",
  "lsp",
  "vcs",
] as const

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

function session(id: string, archived?: number): Session {
  return {
    id,
    title: `Session ${id}`,
    time: { created: 1, updated: 1, ...(archived ? { archived } : {}) },
    version: "1",
  } as unknown as Session
}

function assistantMessage(id: string, sessionID: string): Message {
  return {
    id,
    sessionID,
    role: "assistant",
    providerID: "anthropic",
    modelID: "claude",
    time: { created: 1 },
  } as unknown as Message
}

function textPart(id: string, messageID: string, text: string): Part {
  return { id, messageID, type: "text", text } as unknown as Part
}

function eventFor(type: string): Event {
  const properties: Record<string, unknown> = (() => {
    switch (type) {
      case "session.created":
        return { info: session("ses_new") }
      case "session.updated":
        return { info: session("ses_1") }
      case "session.deleted":
        return { info: session("ses_1") }
      case "session.diff":
        return { sessionID: "ses_1", diff: [] }
      case "session.status":
        return { sessionID: "ses_1", status: { type: "busy" } }
      case "session.idle":
      case "session.error":
        return { sessionID: "ses_1" }
      case "todo.updated":
        return { sessionID: "ses_1", todos: [{ id: "todo_1", content: "x", status: "pending", priority: "high" }] }
      case "message.updated":
        return { info: assistantMessage("msg_1", "ses_1") }
      case "message.removed":
        return { sessionID: "ses_1", messageID: "msg_1" }
      case "message.part.updated":
        return { part: textPart("prt_1", "msg_1", "hello") }
      case "message.part.removed":
        return { messageID: "msg_1", partID: "prt_1" }
      case "message.part.delta":
        return { messageID: "msg_1", partID: "prt_1", field: "text", delta: "x" }
      case "vcs.branch.updated":
        return { branch: "feature" }
      case "permission.asked":
        return { id: "per_1", sessionID: "ses_1", permission: "bash", patterns: [], metadata: {}, always: [] }
      case "permission.replied":
        return { sessionID: "ses_1", requestID: "per_1" }
      case "question.asked":
        return { id: "que_1", sessionID: "ses_1", questions: [] }
      case "question.replied":
      case "question.rejected":
        return { sessionID: "ses_1", requestID: "que_1" }
      default:
        return {}
    }
  })()
  return { type, properties } as unknown as Event
}

/**
 * Baseline state where every tracked slice holds data the event can act on,
 * deep-frozen so an in-place write through an un-cloned reference throws.
 */
function frozenBaseline(): State {
  const baseline: State = {
    ...INITIAL_STATE,
    status: "complete",
    session: [session("ses_1")],
    sessionTotal: 1,
    message: { ses_1: [assistantMessage("msg_1", "ses_1")] },
    part: { msg_1: [textPart("prt_1", "msg_1", "")] },
    permission: { ses_1: [{ id: "per_1", sessionID: "ses_1" } as State["permission"][string][number]] },
    question: { ses_1: [{ id: "que_1", sessionID: "ses_1" } as State["question"][string][number]] },
    todo: { ses_1: [] },
    session_status: { ses_1: { type: "idle" } },
    session_diff: {},
    lsp: [],
    vcs: { branch: "main" } as State["vcs"],
  }
  return deepFreeze(baseline)
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) return value
  seen.add(value)
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key], seen)
  }
  return Object.freeze(value)
}

function clonedSlices(before: State, after: State): string[] {
  return TRACKED_SLICES.filter((key) => before[key] !== after[key])
}

// ---------------------------------------------------------------------------
// (a) documented event types clone exactly the documented slices
// ---------------------------------------------------------------------------

describe("prepareEventDraft vs the documented event → field table", () => {
  for (const [type, documented] of Object.entries(DOCUMENTED_EVENT_SLICES)) {
    test(`${type} clones exactly: ${documented.join(", ") || "(none)"}`, () => {
      const baseline = frozenBaseline()
      const event = eventFor(type)
      // session.deleted always runs the lifecycle cleanup path, so the driver
      // clones the extra lifecycle slices up front.
      const expected =
        type === "session.deleted" ? [...documented, ...LIFECYCLE_EXTRA_SLICES].sort() : [...documented].sort()

      const draft = prepareEventDraft(baseline, event)
      expect(draft).not.toBe(baseline)
      expect(clonedSlices(baseline, draft).sort()).toEqual(expected)

      // The reducer must be able to apply the event without writing through
      // an un-cloned (frozen) reference. vcs.branch.updated replaces draft.vcs
      // by assignment (documented as "mutates draft.vcs directly"), which is
      // safe without cloning because the previous state object is untouched.
      expect(() => applyDirectoryEvent(draft, event)).not.toThrow()
      const expectedAfterReduce = type === "vcs.branch.updated" ? [...expected, "vcs"].sort() : expected
      expect(clonedSlices(baseline, draft).sort()).toEqual(expectedAfterReduce)
    })
  }

  test("archived session.updated clones the documented lifecycle slices too", () => {
    const baseline = frozenBaseline()
    const event = { type: "session.updated", properties: { info: session("ses_1", 2) } } as unknown as Event
    const expected = [...DOCUMENTED_EVENT_SLICES["session.updated"], ...LIFECYCLE_EXTRA_SLICES].sort()

    const draft = prepareEventDraft(baseline, event)
    expect(clonedSlices(baseline, draft).sort()).toEqual(expected)
    expect(() => applyDirectoryEvent(draft, event)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// (b) message.part.delta burst — referential stability through the real
// pipeline → reducer → child-store path
// ---------------------------------------------------------------------------

function deltaEvent(index: number, delta: string): Event {
  return {
    type: "message.part.delta",
    properties: { messageID: "msg_1", partID: "prt_1", field: "text", delta },
  } as unknown as Event
}

function createSdk(events: Event[], directory: string) {
  return {
    global: {
      event: async ({ signal }: { signal: AbortSignal }) => ({
        stream: (async function* () {
          for (const payload of events) {
            yield { directory, payload }
          }
          await new Promise<void>((resolve) => {
            if (signal.aborted) return resolve()
            signal.addEventListener("abort", () => resolve(), { once: true })
          })
        })(),
      }),
    },
  } as unknown as Parameters<typeof createEventPipeline>[0]["sdk"]
}

describe("message.part.delta burst referential stability", () => {
  test("leaves untouched slices reference-identical across the whole burst", async () => {
    const directory = "/repo"
    const manager = new ChildStoreManager()
    const store = manager.ensureChild(directory, { bootstrap: false })

    const seeded: State = {
      ...INITIAL_STATE,
      status: "complete",
      session: [session("ses_1"), session("ses_other")],
      sessionTotal: 2,
      message: {
        ses_1: [assistantMessage("msg_1", "ses_1")],
        ses_other: [assistantMessage("msg_other", "ses_other")],
      },
      part: {
        msg_1: [textPart("prt_1", "msg_1", "")],
        msg_other: [textPart("prt_other", "msg_other", "untouched")],
      },
      permission: { ses_other: [{ id: "per_1", sessionID: "ses_other" } as State["permission"][string][number]] },
      todo: { ses_1: [] },
      session_status: { ses_1: { type: "busy" } },
      session_diff: { ses_other: [] },
    }
    store.setState(seeded)

    // Capture the references that must survive the burst untouched.
    const stableSlices = [
      "session",
      "message",
      "permission",
      "question",
      "todo",
      "session_status",
      "session_diff",
      "lsp",
      "vcs",
    ] as const
    const before = store.getState()
    const stableReferences = new Map<string, unknown>(stableSlices.map((key) => [key, before[key]]))
    const unrelatedMessage = before.message.ses_other
    const unrelatedPart = before.part.msg_other
    const owningMessage = before.message.ses_1

    // Every intermediate state during the burst must keep those references.
    const violations: string[] = []
    const unsubscribe = store.subscribe((state) => {
      for (const [key, reference] of stableReferences) {
        if ((state as unknown as Record<string, unknown>)[key] !== reference) violations.push(key)
      }
      if (state.message.ses_other !== unrelatedMessage) violations.push("message.ses_other")
      if (state.part.msg_other !== unrelatedPart) violations.push("part.msg_other")
    })

    // Compose the same draft → reduce → commit core the production
    // handleEvent runs (its toast/materialization side paths are irrelevant
    // to slice identity).
    const handle = (_directory: string, payload: Event) => {
      const current = store.getState()
      const draft = prepareEventDraft(current, payload)
      const result = applyDirectoryEvent(draft, payload)
      const changed = typeof result === "boolean" ? result : result.changed
      if (changed) store.setState(draft)
    }

    const deltas = Array.from({ length: 90 }, (_, index) => `d${String(index).padStart(2, "0")}|`)
    const pipeline = createEventPipeline({
      sdk: createSdk(
        deltas.map((delta, index) => deltaEvent(index, delta)),
        directory,
      ),
      onEvent: handle,
      transport: "sse",
      heartbeatTimeoutMs: 5_000,
    })

    try {
      const expectedText = deltas.join("")
      await vi.waitFor(
        () => {
          const part = store.getState().part.msg_1?.[0] as { text?: string } | undefined
          expect(part?.text).toBe(expectedText)
        },
        { timeout: 5_000, interval: 10 },
      )
    } finally {
      pipeline.cleanup()
      unsubscribe()
    }

    // No intermediate state ever broke slice identity.
    expect(violations).toEqual([])

    // Final state: the streaming part changed, everything else is identical.
    const after = store.getState()
    for (const [key, reference] of stableReferences) {
      expect((after as unknown as Record<string, unknown>)[key], `slice ${key}`).toBe(reference)
    }
    expect(after.message.ses_1).toBe(owningMessage)
    expect(after.message.ses_other).toBe(unrelatedMessage)
    expect(after.part.msg_other).toBe(unrelatedPart)
    expect(after.part.msg_1).not.toBe(before.part.msg_1)

    manager.disposeAll()
  })
})

// ---------------------------------------------------------------------------
// Drift guard — the fixture above must match the DOCUMENTATION.md table.
// ---------------------------------------------------------------------------

function parseDocumentedEventTypes(): string[] {
  const section = documentation.split("## Event → field mapping")[1]?.split("\n## ")[0] ?? ""

  const types: string[] = []
  for (const line of section.split("\n")) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|/)
    if (!match) continue
    const cell = match[1]
    const [first, ...rest] = cell.split("/")
    types.push(first)
    const prefix = first.replace(/[^.]+$/, "")
    for (const segment of rest) {
      types.push(prefix + segment)
    }
  }
  return types.sort()
}

test("the fixture covers exactly the event types documented in DOCUMENTATION.md", () => {
  expect(Object.keys(DOCUMENTED_EVENT_SLICES).sort()).toEqual(parseDocumentedEventTypes())
})
