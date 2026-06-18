import { describe, expect, test } from "bun:test"
import { normalizeDialogSessions } from "../../../src/cli/cmd/tui/component/session-list-data"

function session(id: string) {
  return {
    id,
    slug: id,
    projectID: "proj_1",
    directory: "/tmp/project",
    title: id,
    version: "1",
    time: {
      created: 1,
      updated: 2,
    },
  }
}

describe("session list data", () => {
  test("normalizes missing or malformed session list payloads to an empty list", () => {
    expect(normalizeDialogSessions(undefined)).toEqual([])
    expect(normalizeDialogSessions(null)).toEqual([])
    expect(normalizeDialogSessions({ id: "ses_1" })).toEqual([])
  })

  test("drops session items that cannot be rendered safely", () => {
    expect(
      normalizeDialogSessions([
        session("ses_1"),
        null,
        { id: "missing-title", time: { updated: 2 } },
        { id: "missing-time", title: "Missing time" },
        { id: "bad-updated", title: "Bad updated", time: { updated: "2" } },
        session("ses_2"),
      ]),
    ).toEqual([session("ses_1"), session("ses_2")])
  })
})
