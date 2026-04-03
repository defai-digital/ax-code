import { describe, expect, test } from "bun:test"
import { upsert } from "../../../src/cli/cmd/tui/context/sync-util"

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
})
