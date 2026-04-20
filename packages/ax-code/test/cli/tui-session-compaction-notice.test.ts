import { describe, expect, test } from "bun:test"
import { firstCompactionMessageID, shouldShowCompactionNotice } from "../../src/cli/cmd/tui/routes/session/compaction-view-model"

describe("tui session compaction notice", () => {
  test("finds the first user message that contains a compaction marker", () => {
    expect(
      firstCompactionMessageID(
        [
          { id: "u1", role: "user" },
          { id: "a1", role: "assistant" },
          { id: "u2", role: "user" },
        ],
        {
          u1: [{ type: "text", text: "hello" }] as any,
          u2: [{ type: "compaction" }] as any,
        },
      ),
    ).toBe("u2")
  })

  test("shows the notice only for the first compaction marker when not dismissed", () => {
    expect(
      shouldShowCompactionNotice({
        currentMessageID: "u2",
        firstMessageID: "u2",
        dismissed: false,
      }),
    ).toBe(true)

    expect(
      shouldShowCompactionNotice({
        currentMessageID: "u3",
        firstMessageID: "u2",
        dismissed: false,
      }),
    ).toBe(false)
  })

  test("suppresses the notice when the session already dismissed it", () => {
    expect(
      shouldShowCompactionNotice({
        currentMessageID: "u2",
        firstMessageID: "u2",
        dismissed: true,
      }),
    ).toBe(false)
  })
})
