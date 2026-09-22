import { describe, expect, test } from "vitest"
import * as Legacy from "../../fixture/projection-retention-legacy"
import * as Current from "../../../src/runtime/headless/projection-retention"

// The incremental pending-byte total is unobservable on its own; every
// divergence in eviction decisions surfaces through floors (admits), the part
// table, and the reload / truncated / limited flags, which are snapshotted
// after each replayed event for both the legacy recompute and the current code.

type Module = typeof Legacy
type State = Parameters<Module["rememberProjectionPart"]>[0] & {
  message: Record<string, Array<{ id: string; role?: string }>>
}

function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

type Event =
  | { kind: "part"; sessionID: string; messageID: string; partID: string; size: number; shape?: string }
  | { kind: "delta"; messageID: string; partID: string; suffix: string }
  | { kind: "message"; sessionID: string; messageID: string }
  | { kind: "forgetPart"; messageID: string; partID: string }
  | { kind: "forgetMessage"; messageID: string; sessionID?: string }
  | { kind: "clearSession"; sessionID: string }
  | { kind: "refresh"; sessionID: string }
  | { kind: "budget"; sessionID: string; maxBytes?: number; maxMessages?: number }
  | { kind: "replaceList"; sessionID: string; keepEvery: number }
  | { kind: "dropList"; sessionID: string }

const SESSIONS = ["s1", "s2", "s3"]
const PART_IDS = ["p1", "p2", "p3"]
// Message ids are globally unique and belong to exactly one session, as in
// production; the session is recoverable from the id.
const messageIDs = SESSIONS.flatMap((sessionID) =>
  Array.from({ length: 14 }, (_, index) => `${sessionID}-m${String(index).padStart(3, "0")}`).concat([
    `${sessionID}-m9`,
    `${sessionID}-m10`,
  ]),
)
const sessionOf = (messageID: string) => messageID.slice(0, messageID.indexOf("-"))

function generate(next: () => number, count: number): Event[] {
  const events: Event[] = []
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!
  for (let index = 0; index < count; index++) {
    const roll = next()
    const messageID = pick(messageIDs)
    const sessionID = roll < 0.93 ? sessionOf(messageID) : pick(SESSIONS)
    if (roll < 0.45) {
      const big = next() < 0.04
      events.push({
        kind: "part",
        sessionID,
        messageID,
        partID: pick(PART_IDS),
        size: big ? 100_000 + Math.floor(next() * 500_000) : Math.floor(next() * 64),
        // Streaming snapshots extend the previous text; some end on a lone
        // high surrogate that the next snapshot completes, some shrink, some
        // replace the text outright, and a few carry no text at all.
        shape: next() < 0.5 ? "extend" : next() < 0.7 ? "surrogate" : next() < 0.8 ? "shrink" : next() < 0.9 ? "replace" : "notext",
      })
    } else if (roll < 0.8) {
      const emoji = next() < 0.1
      events.push({
        kind: "delta",
        messageID,
        partID: pick(PART_IDS),
        suffix: emoji ? "😀".slice(Math.floor(next() * 2)) : "x".repeat(Math.floor(next() * 12)),
      })
    } else if (roll < 0.88) {
      // Re-admitting an existing message exercises the overwrite path.
      events.push({ kind: "message", sessionID, messageID })
    } else if (roll < 0.91) {
      events.push({ kind: "forgetPart", messageID, partID: pick(PART_IDS) })
    } else if (roll < 0.93) {
      events.push({ kind: "forgetMessage", messageID, sessionID: next() < 0.5 ? sessionID : undefined })
    } else if (roll < 0.94) {
      events.push({ kind: "clearSession", sessionID })
    } else if (roll < 0.96) {
      events.push({ kind: "refresh", sessionID })
    } else {
      events.push({
        kind: "budget",
        sessionID,
        maxBytes: next() < 0.5 ? 2000 : undefined,
        maxMessages: next() < 0.5 ? 3 : undefined,
      })
    }
    // Snapshot hydration replaces a session's list (then refreshes sizes) and
    // session teardown drops it (after clearing the ledger), as production does.
    if (next() < 0.03) events.push({ kind: "replaceList", sessionID, keepEvery: 1 + Math.floor(next() * 3) })
    if (next() < 0.01) events.push({ kind: "dropList", sessionID })
    // Budget checks run on every transcript event in production; interleave
    // them densely so eviction decisions are compared at every step.
    if (next() < 0.35) events.push({ kind: "budget", sessionID, maxBytes: next() < 0.3 ? 2000 : undefined })
  }
  return events
}

type Budgets = Map<string, string>

function apply(mod: Module, state: State, tails: Map<string, string>, event: Event, budgets?: Budgets) {
  switch (event.kind) {
    case "part": {
      const parts = (state.part[event.messageID] ??= [])
      const existing = parts.findIndex((part) => (part as { id: string }).id === event.partID)
      const previous = existing >= 0 ? ((parts[existing] as { text?: string }).text ?? "") : ""
      let text: string | undefined
      switch (event.shape) {
        case "extend":
          text = previous + "é\"\\".repeat(1 + (event.size % 5)) + "a".repeat(event.size % 40)
          break
        case "surrogate":
          // Complete a dangling high surrogate first, then leave a new one.
          text = (previous.endsWith("\ud83d") ? previous + "\ude00" : previous) + "x".repeat(event.size % 9) + "\ud83d"
          break
        case "shrink":
          text = previous.slice(0, Math.floor(previous.length / 2))
          break
        case "notext":
          text = undefined
          break
        default:
          text = "a".repeat(event.size)
      }
      const part =
        text === undefined
          ? { id: event.partID, messageID: event.messageID, sessionID: event.sessionID, type: "tool", state: { status: "completed" } }
          : { id: event.partID, messageID: event.messageID, sessionID: event.sessionID, text }
      if (existing >= 0) parts[existing] = part
      else parts.push(part)
      mod.rememberProjectionPart(state, part)
      return
    }
    case "delta": {
      const key = `${event.messageID}\0${event.partID}`
      const previousTail = tails.get(key) ?? ""
      mod.rememberProjectionDelta(state, event.messageID, event.partID, event.suffix, previousTail.slice(-1))
      tails.set(key, previousTail + event.suffix)
      return
    }
    case "message": {
      const list = (state.message[event.sessionID] ??= [])
      if (!list.some((message) => message.id === event.messageID)) list.push({ id: event.messageID, role: "assistant" })
      mod.rememberProjectionMessage(state, { id: event.messageID, sessionID: event.sessionID })
      return
    }
    case "forgetPart":
      mod.forgetProjectionPart(state, event.messageID, event.partID)
      return
    case "forgetMessage":
      mod.forgetProjectionMessage(state, event.messageID, event.sessionID)
      return
    case "clearSession":
      mod.clearProjectionSession(state, event.sessionID)
      delete state.message[event.sessionID]
      return
    case "refresh":
      mod.refreshProjectionSizes(state, event.sessionID)
      return
    case "replaceList": {
      // Mirrors sync-session-store snapshot hydration: the list is replaced,
      // then sizes are refreshed from it before the next budget check.
      const list = state.message[event.sessionID] ?? []
      state.message[event.sessionID] = list.filter((_, index) => index % event.keepEvery === 0)
      mod.refreshProjectionSizes(state, event.sessionID)
      return
    }
    case "dropList":
      // Mirrors session delete / leave prune: the ledger is cleared first.
      mod.clearProjectionSession(state, event.sessionID)
      delete state.message[event.sessionID]
      return
    case "budget": {
      const result = mod.enforceTranscriptBudget(state, event.sessionID, {
        maxBytes: event.maxBytes,
        maxMessages: event.maxMessages,
      })
      budgets?.set(event.sessionID, JSON.stringify(result))
      return
    }
  }
}

function snapshot(mod: Module, state: State, budgets?: Budgets) {
  return JSON.stringify({
    budgets: budgets ? [...budgets.entries()].sort() : undefined,
    messages: Object.fromEntries(Object.entries(state.message).map(([key, list]) => [key, list.map((m) => m.id)])),
    partKeys: Object.keys(state.part).sort(),
    partCounts: Object.fromEntries(Object.entries(state.part).map(([key, list]) => [key, list.length])),
    truncated: state.message_truncated ?? null,
    reload: state.message_reload ?? null,
    limited: state.message_memory_limited ?? null,
    admits: SESSIONS.flatMap((sessionID) =>
      messageIDs.map((messageID) => mod.admitsProjectionPart(state, { messageID, sessionID })),
    ),
    deltas: messageIDs.flatMap((messageID) =>
      PART_IDS.map((partID) => mod.getProjectionDelta(state, messageID, partID) ?? null),
    ),
  })
}

function fresh(): State {
  return { message: {}, part: {}, message_truncated: {}, message_memory_limited: {}, message_reload: {} }
}

describe("projection retention incremental pending total", () => {
  test("handcrafted sequences match the legacy recompute", () => {
    const events: Event[] = []
    // Push pending past the message cap with tiny parts, then stream into an evicted one.
    for (let index = 0; index < 140; index++) events.push({ kind: "part", sessionID: "s1", messageID: `m${String(index % 40).padStart(3, "0")}x${index}`, partID: "p1", size: 1 })
    events.push({ kind: "delta", messageID: "m000x0", partID: "p1", suffix: "still streaming" })
    events.push({ kind: "part", sessionID: "s1", messageID: "m000x0", partID: "p2", size: 3 })
    // One part above the byte cap, then a message admitted while pending.
    events.push({ kind: "part", sessionID: "s2", messageID: "m001", partID: "p1", size: 1_100_000 })
    events.push({ kind: "part", sessionID: "s2", messageID: "m002", partID: "p1", size: 10 })
    events.push({ kind: "message", sessionID: "s2", messageID: "m002" })
    events.push({ kind: "delta", messageID: "m002", partID: "p1", suffix: "\ud83d" })
    events.push({ kind: "delta", messageID: "m002", partID: "p1", suffix: "\ude00" })
    events.push({ kind: "forgetPart", messageID: "m002", partID: "p1" })
    events.push({ kind: "refresh", sessionID: "s2" })
    events.push({ kind: "clearSession", sessionID: "s2" })
    events.push({ kind: "part", sessionID: "s2", messageID: "m002", partID: "p1", size: 5 })

    const legacy = fresh()
    const current = fresh()
    const tailsA = new Map<string, string>()
    const tailsB = new Map<string, string>()
    const budgetsA: Budgets = new Map()
    const budgetsB: Budgets = new Map()
    for (const event of events) {
      apply(Legacy, legacy, tailsA, event, budgetsA)
      apply(Current, current, tailsB, event, budgetsB)
      expect(snapshot(Current, current, budgetsB), JSON.stringify(event).slice(0, 120)).toBe(
        snapshot(Legacy, legacy, budgetsA),
      )
    }
  })

  test("seeded random replays match the legacy recompute after every event", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const next = rng(seed * 2654435761)
      const legacy = fresh()
      const current = fresh()
      const tailsA = new Map<string, string>()
      const tailsB = new Map<string, string>()
      const budgetsA: Budgets = new Map()
      const budgetsB: Budgets = new Map()
      for (const event of generate(next, 600)) {
        apply(Legacy, legacy, tailsA, event, budgetsA)
        apply(Current, current, tailsB, event, budgetsB)
        expect(snapshot(Current, current, budgetsB), `seed ${seed} ${event.kind}`).toBe(
          snapshot(Legacy, legacy, budgetsA),
        )
      }
    }
  })
})
