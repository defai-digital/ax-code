import { describe, expect, test } from "vitest"
import { EventJournal } from "../../src/bus/event-journal"

describe("EventJournal", () => {
  test("keeps cursor suffixes correct after repeated retention and storage compaction", () => {
    const journal = new EventJournal<number>({ epoch: "rolling", maxEvents: 2048 })
    for (let i = 0; i < 10_000; i++) journal.append(i)
    const all = journal.replayAfter("rolling:7952")
    expect(all.type).toBe("replay")
    expect(all.entries.map((entry) => entry.sequence)).toEqual(Array.from({ length: 2048 }, (_, i) => 7953 + i))
    expect(journal.replayAfter("rolling:7951")).toMatchObject({ type: "gap", reason: "cursor_expired" })
    expect(journal.replayAfter("rolling:9999").entries.map((entry) => entry.value)).toEqual([9999])
    all.entries.length = 0
    expect(journal.replayAfter("rolling:7952").entries).toHaveLength(2048)
  })

  test("evicts enough UTF-8 bytes and resumes a retained suffix after an oversized event", () => {
    const journal = new EventJournal<string>({ epoch: "bytes", maxEvents: 8, maxBytes: 10 })
    journal.append("aa")
    journal.append("bb")
    const third = journal.append("ccc")
    expect(journal.replayAfter("bytes:0")).toMatchObject({ type: "gap", reason: "cursor_expired" })
    expect(journal.replayAfter("bytes:1").entries.map((entry) => entry.value)).toEqual(["bb", "ccc"])
    const oversized = journal.append("x".repeat(20))
    const after = journal.append("dd")
    expect(journal.replayAfter(third.id)).toMatchObject({ type: "gap", reason: "cursor_expired" })
    expect(journal.replayAfter(oversized.id).entries).toEqual([after])
  })

  test("retains no events when disabled while still advancing the live cursor", () => {
    const journal = new EventJournal<number>({ epoch: "disabled", maxEvents: 0 })
    const entry = journal.append(1)
    expect(journal.replayAfter("disabled:0")).toMatchObject({ type: "gap", reason: "cursor_expired" })
    expect(journal.replayAfter(entry.id)).toMatchObject({ type: "replay", entries: [] })
  })

  test("replays every retained event after a cursor", () => {
    const journal = new EventJournal<{ value: number }>({ epoch: "boot-a", maxEvents: 4 })
    const start = journal.cursor()
    const first = journal.append({ value: 1 })
    const second = journal.append({ value: 2 })

    expect(journal.replayAfter(start)).toMatchObject({
      type: "replay",
      cursor: second.id,
      entries: [first, second],
    })
    expect(journal.replayAfter(first.id)).toMatchObject({
      type: "replay",
      cursor: second.id,
      entries: [second],
    })
  })

  test("distinguishes restart, invalid, ahead, and expired cursors", () => {
    const journal = new EventJournal<{ value: number }>({ epoch: "boot-b", maxEvents: 2 })
    journal.append({ value: 1 })
    journal.append({ value: 2 })
    journal.append({ value: 3 })

    expect(journal.replayAfter("old-boot:1")).toMatchObject({ type: "gap", reason: "server_restarted" })
    expect(journal.replayAfter("not-a-cursor")).toMatchObject({ type: "gap", reason: "invalid_cursor" })
    expect(journal.replayAfter("boot-b:99")).toMatchObject({ type: "gap", reason: "cursor_ahead" })
    expect(journal.replayAfter("boot-b:0")).toMatchObject({ type: "gap", reason: "cursor_expired" })
    expect(journal.replayAfter("boot-b:1")).toMatchObject({
      type: "replay",
      entries: [{ sequence: 2 }, { sequence: 3 }],
    })
  })

  test("bounds retained history by UTF-8 bytes", () => {
    const journal = new EventJournal<string>({ epoch: "boot-c", maxEvents: 10, maxBytes: 8 })
    const before = journal.cursor()
    const oversized = journal.append("你好世界")

    expect(oversized.bytes).toBeGreaterThan(8)
    expect(journal.replayAfter(before)).toMatchObject({ type: "gap", reason: "cursor_expired" })
    expect(journal.replayAfter(oversized.id)).toMatchObject({ type: "replay", entries: [] })
  })

  test("serializes non-JSON-native event values without breaking the journal", () => {
    const journal = new EventJournal<unknown>({ epoch: "boot-d" })
    const payload: Record<string, unknown> = { value: 1n }
    payload.self = payload

    const entry = journal.append(payload)

    expect(entry.data).toContain('"value":"1"')
    expect(entry.data).toContain('"self":"[Circular]"')
  })
})
