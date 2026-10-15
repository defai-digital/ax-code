import { describe, expect, test } from "vitest"
import {
  createPartSnapshotElider,
  type ElidedPartCoverage,
  type PartStreamEvent,
} from "../../../src/cli/tui/util/elide-part-snapshot"
import { applyHeadlessProjectionEvent, createHeadlessProjectionState } from "../../../src/runtime/headless/projection"

type Session = { id: string }
type Todo = { id: string }
type Diff = { path: string }
type Status = { type: string }
type Message = { id: string; sessionID: string }
type Part = {
  id: string
  messageID: string
  sessionID?: string
  type?: string
  text?: string
  time?: { start?: number; end?: number }
}

// The elider is clock-free: verification moved to the renderer, which checks
// the `elided` prefix on every elided snapshot. `set` only documents the
// timeline a case models.
function clocked(_start = 0) {
  return {
    tracker: createPartSnapshotElider(),
    set(_next: number) {},
  }
}

function elidedOf(event: unknown): ElidedPartCoverage | undefined {
  return (event as { properties?: { elided?: ElidedPartCoverage } }).properties?.elided
}

function updated(
  text: string,
  init: { id?: string; type?: string; end?: number; metadata?: Record<string, unknown> } = {},
) {
  return {
    type: "message.part.updated" as const,
    properties: {
      part: {
        id: init.id ?? "prt_1",
        messageID: "msg_1",
        sessionID: "ses_1",
        type: init.type ?? "text",
        text,
        time: init.end === undefined ? { start: 1 } : { start: 1, end: init.end },
        ...(init.metadata ? { metadata: init.metadata } : {}),
      },
    },
  }
}

function delta(text: string, offset?: number, init: { field?: string; id?: string } = {}) {
  return {
    type: "message.part.delta" as const,
    properties: {
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: init.id ?? "prt_1",
      field: init.field ?? "text",
      delta: text,
      ...(offset === undefined ? {} : { offset }),
    },
  }
}

function removed(id = "prt_1") {
  return {
    type: "message.part.removed" as const,
    properties: { sessionID: "ses_1", messageID: "msg_1", partID: id },
  }
}

function hasText(event: unknown) {
  if (!event || typeof event !== "object") return false
  const part = (event as { properties?: { part?: object } }).properties?.part
  return !!part && Object.prototype.hasOwnProperty.call(part, "text")
}

function project(events: readonly unknown[]) {
  const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()
  for (const event of events) applyHeadlessProjectionEvent(state, event as never)
  return state.part["msg_1"]?.[0]?.text
}

type TimedPartEvent = { at: number; event: ReturnType<typeof updated> | ReturnType<typeof delta> }

/**
 * Deltas of 512 chars every 25 ms, coalesced by the 16 ms delta batcher.
 * Snapshots follow the processor window max(250, len/1024), clamped to
 * 2000 ms. The armed window is not extended. A progress snapshot publishes
 * the text through the current chunk while any delta still inside its 16 ms
 * window flushes AFTER that snapshot (part-write and delta timers are
 * independent; only text-end flushes deltas first). text-start is an
 * immediate empty snapshot; text-end drops a still-pending progress
 * snapshot and publishes the terminal one.
 */
function productionOrdered1MiB() {
  const chunk = "x".repeat(512)
  const chunks = (1024 * 1024) / chunk.length
  const CHUNK_MS = 25
  const DELTA_MS = 16
  const windowFor = (length: number) => Math.min(2000, Math.max(250, length / 1024))

  let text = ""
  let deltaDue: number | undefined
  let deltaOffset: number | undefined
  const deltaParts: string[] = []
  let partDue: number | undefined
  let partText: string | undefined
  const raw: TimedPartEvent[] = []

  const flushDeltas = (at: number) => {
    deltaDue = undefined
    if (deltaParts.length === 0 || deltaOffset === undefined) return
    const body = deltaParts.join("")
    const offset = deltaOffset
    deltaParts.length = 0
    deltaOffset = undefined
    raw.push({ at, event: delta(body, offset) })
  }

  const flushPart = (at: number) => {
    partDue = undefined
    if (partText === undefined) return
    const snap = partText
    partText = undefined
    raw.push({ at, event: updated(snap) })
  }

  // Snapshot wins a tie: that is the production race this measurement covers.
  const drain = (at: number, inclusive: boolean) => {
    const ready = (when: number | undefined) => when !== undefined && (inclusive ? when <= at : when < at)
    while (ready(deltaDue) || ready(partDue)) {
      const nextDelta = ready(deltaDue) ? deltaDue! : Number.POSITIVE_INFINITY
      const nextPart = ready(partDue) ? partDue! : Number.POSITIVE_INFINITY
      if (nextPart <= nextDelta) flushPart(nextPart)
      else flushDeltas(nextDelta)
    }
  }

  raw.push({ at: 0, event: updated("") })
  for (let i = 0; i < chunks; i++) {
    const at = i * CHUNK_MS
    drain(at, false)
    const offset = text.length
    text += chunk
    if (deltaOffset === undefined) deltaOffset = offset
    deltaParts.push(chunk)
    if (deltaDue === undefined) deltaDue = at + DELTA_MS
    partText = text
    const delay = windowFor(text.length)
    if (partDue === undefined) partDue = at + delay
    else if (delay < partDue - at) partDue = at + delay
    drain(at, true)
  }
  const terminalAt = chunks * CHUNK_MS
  drain(terminalAt, false)
  flushDeltas(terminalAt)
  partDue = undefined
  partText = undefined
  raw.push({ at: terminalAt, event: updated(text, { end: terminalAt }) })

  let raced = 0
  let progress = 0
  for (let i = 0; i < raw.length; i++) {
    const event = raw[i]!.event
    if (event.type !== "message.part.updated") continue
    if (event.properties.part.time.end !== undefined) continue
    const length = event.properties.part.text?.length ?? 0
    if (length === 0) continue
    progress++
    for (let j = i + 1; j < raw.length; j++) {
      const next = raw[j]!.event
      if (next.type === "message.part.updated") break
      if (next.type === "message.part.delta" && (next.properties.offset ?? 0) < length) {
        raced++
        break
      }
    }
  }

  return { text, raw, progress, raced }
}

function projectElided(events: readonly TimedPartEvent[], mark?: number) {
  const elider = createPartSnapshotElider()
  const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()
  // Admit the message first. Otherwise the part stays pending and the 1 MiB
  // pending budget evicts it before the terminal snapshot.
  applyHeadlessProjectionEvent(state, {
    type: "message.updated",
    properties: { info: { id: "msg_1", sessionID: "ses_1" } },
  } as never)
  const emitted: PartStreamEvent[] = []
  let marked: string | undefined
  for (let index = 0; index < events.length; index++) {
    const item = events[index]!
    const out = elider.observe(item.event)
    emitted.push(out)
    applyHeadlessProjectionEvent(state, out as never)
    if (index === mark) marked = state.part["msg_1"]?.[0]?.text
  }
  return { emitted, marked, final: state.part["msg_1"]?.[0]?.text }
}

describe("part snapshot elision", () => {
  test("elides a later text or reasoning snapshot when deltas cover it contiguously", () => {
    const { tracker, set } = clocked()
    const first = updated("Hello")
    expect(tracker.observe(first)).toBe(first)

    const piece = delta(" world", 5)
    expect(tracker.observe(piece)).toBe(piece)

    set(100)
    const second = updated("Hello world", { metadata: { provider: "test" } })
    const elided = tracker.observe(second)
    expect(elided).not.toBe(second)
    expect(hasText(elided)).toBe(false)
    expect(elided.properties.part).toMatchObject({
      id: "prt_1",
      type: "text",
      metadata: { provider: "test" },
    })
    // Shallow copy: nested objects are shared, `text` is not.
    expect(elided.properties.part.time).toBe(second.properties.part.time)
    expect(elided.properties.part.metadata).toBe(second.properties.part.metadata)

    // Reasoning parts publish `field: "text"` deltas (delta batcher). Same rule.
    const prefix = "p".repeat(80)
    const extra = "q".repeat(10)
    expect(tracker.observe(updated(prefix, { id: "prt_r", type: "reasoning" })).properties.part.text).toBe(prefix)
    expect(tracker.observe(delta(extra, prefix.length, { id: "prt_r" }))).toMatchObject({
      properties: { field: "text" },
    })
    set(150)
    const reasoning = tracker.observe(updated(prefix + extra, { id: "prt_r", type: "reasoning" }))
    expect(hasText(reasoning)).toBe(false)
    expect(reasoning.properties.part.type).toBe("reasoning")
  })

  test("a gap invalidates coverage, and a later delta does not rebuild across it", () => {
    const { tracker, set } = clocked()
    tracker.observe(updated("Hello"))
    tracker.observe(delta("x", 7))
    // Contiguous with the hole, not with the covered prefix. The renderer
    // skips both (`offset > length`) and will keep skipping, so coverage is
    // cleared and the repeat is forwarded whole.
    tracker.observe(delta("y", 8))
    set(10)
    const repeat = updated("Hello")
    expect(tracker.observe(repeat)).toBe(repeat)
    expect(repeat.properties.part.text).toBe("Hello")

    // Re-seeded from that full snapshot. A delta at the new end extends it.
    tracker.observe(delta("!", 5))
    set(20)
    const next = tracker.observe(updated("Hello!"))
    expect(hasText(next)).toBe(false)
  })

  test("an overlap inside coverage appends only the suffix past the end", () => {
    const { tracker, set } = clocked()
    tracker.observe(updated("Hello"))
    // Fully inside. The renderer keeps "Hello"; coverage must not invalidate.
    tracker.observe(delta("Y", 0))
    set(10)
    const same = tracker.observe(updated("Hello"))
    expect(hasText(same)).toBe(false)

    // offset 4 overlaps the last covered char and adds one new char.
    tracker.observe(delta("o!", 4))
    set(20)
    const extended = tracker.observe(updated("Hello!"))
    expect(hasText(extended)).toBe(false)

    // A real rewrite still fails the length check and is forwarded whole.
    const rewritten = updated("Y!")
    expect(tracker.observe(rewritten)).toBe(rewritten)
    expect(rewritten.properties.part.text).toBe("Y!")
  })

  test("forwards a full snapshot when the tail differs at the same length", () => {
    const { tracker, set } = clocked()
    tracker.observe(updated("Hello"))
    set(10)
    const other = updated("World")
    expect(other.properties.part.text.length).toBe("Hello".length)
    expect(tracker.observe(other)).toBe(other)
    expect(other.properties.part.text).toBe("World")

    set(20)
    const again = tracker.observe(updated("World"))
    expect(hasText(again)).toBe(false)
  })

  test("terminal snapshot is always full and drops state", () => {
    const { tracker, set } = clocked()
    tracker.observe(updated("Hello"))
    tracker.observe(delta("!", 5))
    set(10)
    const term = updated("Hello!", { end: 50 })
    expect(tracker.observe(term)).toBe(term)
    expect(term.properties.part.text).toBe("Hello!")

    set(20)
    const again = updated("Hello!")
    expect(tracker.observe(again)).toBe(again)
    expect(hasText(again)).toBe(true)
  })

  test("drops part state on message.part.removed", () => {
    const { tracker, set } = clocked()
    tracker.observe(updated("Hello"))
    tracker.observe(delta("!", 5))
    const gone = removed()
    expect(tracker.observe(gone)).toBe(gone)
    set(10)
    const again = updated("Hello!")
    expect(tracker.observe(again)).toBe(again)
  })

  test("first snapshot is always full", () => {
    const { tracker, set } = clocked()
    tracker.observe(delta("Hello", 0))
    const first = updated("Hello")
    expect(tracker.observe(first)).toBe(first)
    expect(hasText(first)).toBe(true)

    set(10)
    const second = tracker.observe(updated("Hello"))
    expect(hasText(second)).toBe(false)
  })

  test("no heartbeat: every covered snapshot is elided and carries the assumed prefix", () => {
    const { tracker, set } = clocked()
    tracker.observe(updated("Hello"))
    tracker.observe(delta("!", 5))

    set(1999)
    const early = tracker.observe(updated("Hello!"))
    expect(hasText(early)).toBe(false)
    expect(elidedOf(early)).toEqual({ end: 6, tail: "Hello!" })

    // Long after the last full snapshot the elision still holds: the renderer
    // verifies `elided` itself instead of receiving a periodic full copy.
    set(60_000)
    const later = tracker.observe(updated("Hello! world"))
    expect(hasText(later)).toBe(false)
    expect(elidedOf(later)).toEqual({ end: 6, tail: "Hello!" })
    expect((later as { properties: { part: { id: string } } }).properties.part.id).toBe("prt_1")

    // The tail is the last 64 covered chars once coverage is longer than that.
    const long = "a".repeat(100)
    tracker.observe(delta(long, 6))
    const wide = tracker.observe(updated("Hello!" + long + "zz"))
    expect(elidedOf(wide)).toEqual({ end: 106, tail: "a".repeat(64) })
    // A full snapshot carries no `elided`.
    expect(elidedOf(tracker.observe(updated("different", { id: "prt_2" })))).toBeUndefined()
  })

  test("reset() forgets coverage", () => {
    const { tracker, set } = clocked()
    tracker.observe(updated("Hello"))
    tracker.observe(delta("!", 5))
    tracker.reset()
    set(10)
    const snap = updated("Hello!")
    expect(tracker.observe(snap)).toBe(snap)
    expect(hasText(snap)).toBe(true)
  })

  test("a missing offset or a non-text field invalidates coverage", () => {
    const missing = clocked()
    missing.tracker.observe(updated("Hello"))
    missing.tracker.observe(delta("!", undefined))
    missing.set(10)
    const afterMissing = updated("Hello!")
    expect(missing.tracker.observe(afterMissing)).toBe(afterMissing)

    const fractional = clocked()
    fractional.tracker.observe(updated("Hello"))
    fractional.tracker.observe(delta("!", 5.5))
    fractional.set(10)
    const afterFractional = updated("Hello!")
    expect(fractional.tracker.observe(afterFractional)).toBe(afterFractional)

    // Reasoning bytes travel as field "text". A different field does not.
    const otherField = clocked()
    otherField.tracker.observe(updated("Hello", { type: "reasoning" }))
    otherField.tracker.observe(delta("!", 5, { field: "reasoning" }))
    otherField.set(10)
    const afterField = updated("Hello!", { type: "reasoning" })
    expect(otherField.tracker.observe(afterField)).toBe(afterField)
  })

  test("non-text parts and unrelated events are returned unchanged", () => {
    const { tracker } = clocked()
    const tool = {
      type: "message.part.updated" as const,
      properties: {
        part: {
          id: "tool_1",
          messageID: "msg_1",
          sessionID: "ses_1",
          type: "tool",
          text: "should stay",
          state: { status: "running" },
        },
      },
    }
    expect(tracker.observe(tool)).toBe(tool)
    expect(tool.properties.part.text).toBe("should stay")

    const status = { type: "session.status" as const, properties: { sessionID: "ses_1", status: { type: "busy" } } }
    expect(tracker.observe(status)).toBe(status)
  })

  test("does not mutate the input event or part", () => {
    const { tracker, set } = clocked()
    tracker.observe(updated("Hello"))
    const piece = delta(" world", 5)
    const pieceBefore = structuredClone(piece)
    expect(tracker.observe(piece)).toBe(piece)
    expect(piece).toEqual(pieceBefore)

    set(10)
    const snap = updated("Hello world", { metadata: { provider: "test" } })
    const part = snap.properties.part
    const before = structuredClone(snap)
    const out = tracker.observe(snap)
    expect(snap).toEqual(before)
    expect(snap.properties.part).toBe(part)
    expect(part.text).toBe("Hello world")
    expect(out).not.toBe(snap)
    expect(out.properties).not.toBe(snap.properties)
    expect(out.properties.part).not.toBe(part)
    expect(hasText(out)).toBe(false)
  })

  test("evicts the least recently observed part past 256", () => {
    const { tracker, set } = clocked()
    for (let i = 0; i < 256; i++) {
      const id = `prt_${i}`
      tracker.observe(updated("a", { id }))
      tracker.observe(delta("b", 1, { id }))
    }
    tracker.observe(updated("a", { id: "prt_256" }))

    set(10)
    const evicted = updated("ab", { id: "prt_0" })
    expect(tracker.observe(evicted)).toBe(evicted)
    expect(hasText(evicted)).toBe(true)

    const hot = tracker.observe(updated("ab", { id: "prt_255" }))
    expect(hasText(hot)).toBe(false)
  })

  test("projection matches the full text, and a lost delta is healed by the next full snapshot or terminal", () => {
    const { tracker, set } = clocked()
    const seen: PartStreamEvent[] = []
    const feed = (event: PartStreamEvent, at: number) => {
      set(at)
      const out = tracker.observe(event)
      seen.push(out)
      return out
    }

    feed(updated(""), 0)
    let text = ""
    for (let i = 0; i < 8; i++) {
      const piece = `tok${i}-`
      const offset = text.length
      text += piece
      feed(delta(piece, offset), 10 + i)
      if (i === 3 || i === 7) {
        const out = feed(updated(text), 10 + i)
        expect(hasText(out)).toBe(false)
      }
    }
    expect(project(seen)).toBe(text)

    const terminal = feed(updated(text, { end: 9 }), 100)
    expect(hasText(terminal)).toBe(true)
    expect(project(seen)).toBe(text)

    const lost = clocked()
    const lostEvents: PartStreamEvent[] = []
    const send = (event: PartStreamEvent, at: number) => {
      lost.set(at)
      const out = lost.tracker.observe(event)
      lostEvents.push(out)
      return out
    }
    send(updated("Hello"), 0)
    send(delta(" ", 5), 10)
    // "world" at offset 6 never reaches the worker. The next delta starts
    // past that hole, which invalidates coverage, so the following snapshot
    // is full and the projection heals immediately.
    send(delta("!", 11), 15)
    const healing = send(updated("Hello world!"), 20)
    expect(hasText(healing)).toBe(true)
    expect(project(lostEvents)).toBe("Hello world!")

    const ended = clocked()
    const endedEvents: PartStreamEvent[] = []
    const sendEnded = (event: PartStreamEvent, at: number) => {
      ended.set(at)
      const out = ended.tracker.observe(event)
      endedEvents.push(out)
      return out
    }
    sendEnded(updated("Hello"), 0)
    sendEnded(delta(" ", 5), 10)
    const done = sendEnded(updated("Hello world", { end: 99 }), 30)
    expect(hasText(done)).toBe(true)
    expect(project(endedEvents)).toBe("Hello world")
  })

  test("production order: a snapshot, overlapping deltas, then a caught-up snapshot is elided", () => {
    // Part-write publishes length L while the 16ms delta batcher still holds
    // chunks that start at L-k and may run past L. The next snapshot, within
    // the heartbeat, matches what those deltas appended.
    const { tracker, set } = clocked()
    const base = "a".repeat(1000)
    const first = updated(base)
    expect(tracker.observe(first)).toBe(first)

    const overlap = "a".repeat(10) + "b".repeat(20)
    expect(overlap).toHaveLength(30)
    tracker.observe(delta(overlap, 990))
    tracker.observe(delta("c".repeat(10), 1020))

    set(100)
    const full = base + "b".repeat(20) + "c".repeat(10)
    expect(full).toHaveLength(1030)
    const second = tracker.observe(updated(full))
    expect(hasText(second)).toBe(false)
    expect(second.properties.part.id).toBe("prt_1")
  })

  test("a delta fully inside coverage changes nothing and the next matching snapshot is elided", () => {
    const { tracker, set } = clocked()
    const text = "d".repeat(1000)
    const first = updated(text)
    expect(tracker.observe(first)).toBe(first)
    expect(tracker.observe(delta("e".repeat(10), 500))).toMatchObject({
      properties: { offset: 500, delta: "e".repeat(10) },
    })
    set(10)
    const again = tracker.observe(updated(text))
    expect(hasText(again)).toBe(false)
  })

  test("production-ordered deltas and snapshots project to the full text", () => {
    const { tracker, set } = clocked()
    const base = "a".repeat(1000)
    const overlap = "a".repeat(10) + "b".repeat(20)
    const full = base + "b".repeat(20) + "c".repeat(10)
    const events = [updated(base), delta(overlap, 990), delta("c".repeat(10), 1020), updated(full)]
    const seen: PartStreamEvent[] = []
    events.forEach((event, index) => {
      set(index * 10)
      seen.push(tracker.observe(event))
    })
    expect(hasText(seen[0])).toBe(true)
    expect(hasText(seen[3])).toBe(false)
    expect(project(seen)).toBe(full)
    // The renderer reconciles the same wire order to the same text.
    expect(project(events)).toBe(full)
  })

  test("elides a longer snapshot whose covered prefix matches, then the following delta extends coverage", () => {
    // Snapshot L=1000, overlap delta 990+30 → end 1020, snapshot L=1536
    // within 2s is elided (renderer keeps the 1020 prefix), then delta
    // 1020+516 brings coverage to 1536.
    const { tracker, set } = clocked()
    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()
    const feed = (event: PartStreamEvent, at: number) => {
      set(at)
      const out = tracker.observe(event)
      applyHeadlessProjectionEvent(state, out as never)
      return out
    }
    const rendered = () => state.part["msg_1"]?.[0]?.text

    const base = "a".repeat(1000)
    const first = updated(base)
    expect(feed(first, 0)).toBe(first)
    expect(rendered()).toBe(base)

    const overlap = "a".repeat(10) + "b".repeat(20)
    expect(overlap).toHaveLength(30)
    feed(delta(overlap, 990), 10)
    const prefix = base + "b".repeat(20)
    expect(prefix).toHaveLength(1020)
    expect(rendered()).toBe(prefix)

    const full = prefix + "c".repeat(516)
    expect(full).toHaveLength(1536)
    const mid = updated(full)
    const elided = feed(mid, 100)
    expect(elided).not.toBe(mid)
    expect(hasText(elided)).toBe(false)
    expect(rendered()).toBe(prefix)

    feed(delta("c".repeat(516), 1020), 110)
    expect(rendered()).toBe(full)

    // end is 1536: the exact text elides, and one character short does not.
    const exact = updated(full)
    expect(hasText(feed(exact, 200))).toBe(false)
    const shorter = updated(full.slice(0, 1535))
    expect(feed(shorter, 300)).toBe(shorter)
    expect(shorter.properties.part.text).toHaveLength(1535)
  })

  test("a snapshot whose covered prefix differs is forwarded full", () => {
    const { tracker, set } = clocked()
    const base = "a".repeat(1000)
    const first = updated(base)
    expect(tracker.observe(first)).toBe(first)
    tracker.observe(delta("a".repeat(10) + "b".repeat(20), 990))
    // end = 1020. The covered window is [956, 1020) = "a"*44 + "b"*20.
    const end = 1020
    const coveredTail = "a".repeat(44) + "b".repeat(20)
    expect(coveredTail).toHaveLength(64)
    // The snapshot's own last 64 chars equal that tail, so a check against
    // the end of the snapshot would pass. The chars in [end-64, end) do not.
    const mismatched = "a".repeat(end - 64) + "c".repeat(64) + coveredTail
    expect(mismatched.slice(end - 64, end)).toBe("c".repeat(64))
    expect(mismatched.slice(-64)).toBe(coveredTail)
    expect(mismatched.length).toBeGreaterThan(end)

    set(100)
    const snap = updated(mismatched)
    expect(tracker.observe(snap)).toBe(snap)
    expect(snap.properties.part.text).toBe(mismatched)
  })

  test("a gap invalidates coverage and the next snapshot is full even when its prefix matches", () => {
    const { tracker, set } = clocked()
    const base = "a".repeat(1000)
    const first = updated(base)
    expect(tracker.observe(first)).toBe(first)
    tracker.observe(delta("a".repeat(10) + "b".repeat(20), 990))
    // end is 1020. A delta at 1100 is a hole. Leaving `end` unchanged would
    // elide the next snapshot, because its prefix still matches.
    tracker.observe(delta("z", 1100))

    set(100)
    const covered = base + "b".repeat(20)
    expect(covered).toHaveLength(1020)
    const healing = updated(covered)
    expect(tracker.observe(healing)).toBe(healing)
    expect(healing.properties.part.text).toBe(covered)

    // Re-seeded from the full snapshot: the same text now elides, and a
    // delta at the new end extends coverage.
    set(150)
    const again = tracker.observe(updated(covered))
    expect(hasText(again)).toBe(false)
    tracker.observe(delta("!", 1020))
    set(200)
    const extended = tracker.observe(updated(covered + "!"))
    expect(hasText(extended)).toBe(false)
  })

  test("1 MiB stream with production ordering: elided snapshots shrink JSON bytes and the projection still matches", () => {
    const { text, raw, progress, raced } = productionOrdered1MiB()
    expect(text.length).toBe(1024 * 1024)
    expect(progress).toBeGreaterThan(0)
    expect(raced).toBeGreaterThan(0)

    const elider = createPartSnapshotElider()
    const state = createHeadlessProjectionState<Session, Todo, Diff, Status, Message, Part>()
    // Admit the message first. Otherwise the part stays pending and the 1 MiB
    // pending budget evicts it before the terminal snapshot.
    applyHeadlessProjectionEvent(state, {
      type: "message.updated",
      properties: { info: { id: "msg_1", sessionID: "ses_1" } },
    } as never)
    const emitted: unknown[] = []
    let elidedSnapshots = 0
    let fullSnapshots = 0
    for (const item of raw) {
      const out = elider.observe(item.event)
      emitted.push(out)
      applyHeadlessProjectionEvent(state, out as never)
      if (item.event.type !== "message.part.updated") continue
      if (hasText(out)) fullSnapshots++
      else {
        elidedSnapshots++
        // The renderer may still be on the covered prefix; the deltas flushed
        // after this snapshot append the rest. The elided event names that
        // prefix, and the projection must hold exactly it at this point.
        const projected = state.part["msg_1"]?.[0]?.text
        expect(projected).toBeDefined()
        expect(item.event.properties.part.text.startsWith(projected!)).toBe(true)
        const elided = elidedOf(out)
        expect(elided?.end).toBe(projected!.length)
        expect(projected!.endsWith(elided!.tail)).toBe(true)
      }
    }
    expect(state.part["msg_1"]?.[0]?.text).toBe(text)
    // Only the empty text-start snapshot and the terminal one stay full.
    expect(fullSnapshots).toBe(2)
    expect(elidedSnapshots).toBe(progress)
    expect(hasText(emitted[emitted.length - 1])).toBe(true)

    const bytes = (events: readonly unknown[]) => {
      let total = 0
      for (const event of events) total += JSON.stringify(event).length
      return total
    }
    const before = bytes(raw.map((item) => item.event))
    const after = bytes(emitted)
    expect(after).toBeLessThan(before)
    console.log(
      `elide-part-snapshot 1MiB JSON.stringify bytes before=${before} after=${after} ` +
        `events=${emitted.length} fullSnapshots=${fullSnapshots} elidedSnapshots=${elidedSnapshots} ` +
        `progressSnapshots=${progress} racedAfterSnapshot=${raced}`,
    )
  }, 60_000)

  test("production-ordered 1 MiB stream round-trips, and a dropped delta is healed by the next full snapshot", () => {
    const { text, raw } = productionOrdered1MiB()
    expect(projectElided(raw).final).toBe(text)

    // Drop a delta that is followed by another delta, then by a progress
    // snapshot still inside the 2s heartbeat. Without the gap invalidation
    // that later delta's offset would leave coverage intact and the snapshot
    // would be elided; with it, the snapshot is full and heals immediately.
    let dropAt = -1
    let originalSnap = -1
    for (let i = 0; i < raw.length; i++) {
      const event = raw[i]!.event
      if (event.type !== "message.part.delta") continue
      const offset = event.properties.offset
      if (offset === undefined) continue
      let sawLaterDelta = false
      let snap = -1
      for (let j = i + 1; j < raw.length; j++) {
        const next = raw[j]!.event
        if (!sawLaterDelta) {
          if (next.type !== "message.part.delta") break
          const nextOffset = next.properties.offset
          if (nextOffset === undefined || nextOffset <= offset) break
          sawLaterDelta = true
          continue
        }
        if (next.type !== "message.part.updated") continue
        if (next.properties.part.time.end !== undefined) break
        if (raw[j]!.at >= 2000) break
        snap = j
        break
      }
      if (snap >= 0) {
        dropAt = i
        originalSnap = snap
        break
      }
    }
    expect(dropAt).toBeGreaterThanOrEqual(0)
    expect(originalSnap).toBeGreaterThan(dropAt)
    expect(raw[originalSnap]!.at).toBeLessThan(2000)

    const kept = raw.filter((_, index) => index !== dropAt)
    const snapKeptIndex = kept.indexOf(raw[originalSnap]!)
    expect(snapKeptIndex).toBeGreaterThanOrEqual(0)
    const dropped = projectElided(kept, snapKeptIndex)
    const snap = raw[originalSnap]!.event
    if (snap.type !== "message.part.updated") throw new Error("expected a snapshot after the dropped delta")
    expect(hasText(dropped.emitted[snapKeptIndex])).toBe(true)
    expect(dropped.marked).toBe(snap.properties.part.text)
    expect(dropped.final).toBe(text)
    expect(hasText(dropped.emitted[dropped.emitted.length - 1])).toBe(true)
  }, 60_000)
})
