import { describe, expect, test } from "vitest"
import { sessionImageAttachments } from "../../../src/cli/tui/routes/session/image-preview"

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
const url = `data:image/png;base64,${PNG}`

const file = (overrides: Record<string, unknown> = {}) => ({
  id: "prt_a",
  sessionID: "ses_a",
  messageID: "msg_a",
  type: "file" as const,
  mime: "image/png",
  filename: "shot.png",
  url,
  ...overrides,
})

describe("session image attachments", () => {
  test("collects user file parts and completed tool attachments, in message order", () => {
    const user = file({ id: "prt_user" })
    const toolAttachment = file({ id: "prt_tool" })
    const parts = {
      msg_1: [user],
      msg_2: [
        {
          id: "prt_call",
          sessionID: "ses_a",
          messageID: "msg_2",
          type: "tool" as const,
          callID: "call_1",
          tool: "read",
          state: {
            status: "completed" as const,
            input: {},
            output: "Image read successfully",
            title: "read",
            metadata: {},
            time: { start: 0, end: 1 },
            attachments: [toolAttachment],
          },
        },
      ],
    }
    expect(
      sessionImageAttachments(
        [
          { id: "msg_1", role: "user" },
          { id: "msg_2", role: "assistant" },
        ],
        parts,
      ),
    ).toEqual([user, toolAttachment])
  })

  test("skips assistant file parts, non-PNG media, and incomplete tool states", () => {
    const parts = {
      msg_1: [file({ id: "prt_assistant", mime: "image/png" })],
      msg_2: [
        file({ id: "prt_user_jpeg", mime: "image/jpeg", url: "data:image/jpeg;base64,AAAA" }),
        file({ id: "prt_user_url", url: "https://example.com/a.png" }),
      ],
      msg_3: [
        {
          id: "prt_pending",
          sessionID: "ses_a",
          messageID: "msg_3",
          type: "tool" as const,
          callID: "call_pending",
          tool: "read",
          state: { status: "running" as const, input: {}, title: "read", time: { start: 0 } },
        },
      ],
    }
    expect(
      sessionImageAttachments(
        [
          { id: "msg_1", role: "assistant" },
          { id: "msg_2", role: "user" },
          { id: "msg_3", role: "assistant" },
        ],
        parts,
      ),
    ).toEqual([])
  })

  test("tolerates a message whose parts have not loaded yet", () => {
    expect(sessionImageAttachments([{ id: "msg_missing", role: "user" }], {})).toEqual([])
  })
})
