import { describe, expect, test } from "bun:test"
import {
  appendTextPartDelta,
  groupBySession,
  removeByID,
  shiftOverflow,
  upsert,
} from "../../../src/cli/cmd/tui/context/sync-util"

describe("tui sync", () => {
  test("inserts a newly created child session in id order", () => {
    const list = [{ id: "ses_1" }, { id: "ses_3" }]

    upsert(list, { id: "ses_2" })

    expect(list.map((item) => item.id)).toEqual(["ses_1", "ses_2", "ses_3"])
  })

  test("replaces an existing session when the same id arrives again", () => {
    const list = [{ id: "ses_1", title: "old" }, { id: "ses_2", title: "keep" }]

    upsert(list, { id: "ses_1", title: "new" })

    expect(list).toEqual([
      { id: "ses_1", title: "new" },
      { id: "ses_2", title: "keep" },
    ])
  })

  test("groups items by session for bootstrap hydration", () => {
    expect(
      groupBySession([
        { id: "perm_1", sessionID: "ses_1" },
        { id: "perm_2", sessionID: "ses_2" },
        { id: "perm_3", sessionID: "ses_1" },
      ]),
    ).toEqual({
      ses_1: [
        { id: "perm_1", sessionID: "ses_1" },
        { id: "perm_3", sessionID: "ses_1" },
      ],
      ses_2: [{ id: "perm_2", sessionID: "ses_2" }],
    })
  })

  test("removes sorted items by id and returns the removed entry", () => {
    const list = [{ id: "msg_1" }, { id: "msg_2" }, { id: "msg_3" }]

    expect(removeByID(list, "msg_2")).toEqual({ id: "msg_2" })
    expect(list).toEqual([{ id: "msg_1" }, { id: "msg_3" }])
    expect(removeByID(list, "msg_9")).toBeUndefined()
  })

  test("drops only the oldest overflow item when bounded lists grow past the cap", () => {
    const list = [{ id: "msg_1" }, { id: "msg_2" }, { id: "msg_3" }]

    expect(shiftOverflow(list, 2)).toEqual({ id: "msg_1" })
    expect(list).toEqual([{ id: "msg_2" }, { id: "msg_3" }])
    expect(shiftOverflow(list, 2)).toBeUndefined()
  })

  test("appends deltas only to text-like parts", () => {
    const parts = [
      { id: "part_1", type: "text", text: "Hello" },
      { id: "part_2", type: "tool", text: "ignored" },
      { id: "part_3", type: "reasoning", text: "" },
    ]

    expect(appendTextPartDelta(parts, "part_1", " world")).toBe(true)
    expect(appendTextPartDelta(parts, "part_2", "!")).toBe(false)
    expect(appendTextPartDelta(parts, "part_3", "thinking")).toBe(true)
    expect(appendTextPartDelta(parts, "part_9", "!")).toBe(false)
    expect(parts).toEqual([
      { id: "part_1", type: "text", text: "Hello world" },
      { id: "part_2", type: "tool", text: "ignored" },
      { id: "part_3", type: "reasoning", text: "thinking" },
    ])
  })
})
