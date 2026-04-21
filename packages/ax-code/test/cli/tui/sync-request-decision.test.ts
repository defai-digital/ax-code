import { describe, expect, test } from "bun:test"
import {
  createAutonomousPermissionReply,
  createAutonomousQuestionReply,
} from "../../../src/cli/cmd/tui/context/sync-request-decision"

describe("tui sync request decision", () => {
  test("creates the default autonomous permission reply payload", () => {
    expect(createAutonomousPermissionReply("req_1")).toEqual({
      requestID: "req_1",
      reply: "once",
    })
  })

  test("creates autonomous question answers from the recommended option set", () => {
    expect(
      createAutonomousQuestionReply("req_2", [
        {
          header: "Plan",
          question: "Which rollout should we pick?",
          options: [
            { label: "Incremental rollout", description: "Recommended small, low-risk path" },
            { label: "Rewrite first", description: "Large refactor with more risk" },
          ],
        },
      ]),
    ).toEqual({
      requestID: "req_2",
      answers: [["Incremental rollout"]],
    })
  })
})
