import { describe, expect, test } from "vitest"

import { getAssistantErrorPresentation } from "./assistantErrorPresentation"

describe("getAssistantErrorPresentation", () => {
  test("hides a recovered attempt when a later assistant response exists", () => {
    expect(
      getAssistantErrorPresentation({
        isUser: false,
        isLastAssistantInTurn: false,
        error: { name: "APIError", data: { message: "invalid access token or token expired" } },
      }),
    ).toBeUndefined()
  })

  test("keeps a final provider authentication failure prominent", () => {
    expect(
      getAssistantErrorPresentation({
        isUser: false,
        isLastAssistantInTurn: true,
        error: { name: "APIError", data: { message: "invalid access token or token expired" } },
      }),
    ).toMatchObject({ variant: "error" })
  })

  test("shows an intentional cancellation as an informational state", () => {
    expect(
      getAssistantErrorPresentation({
        isUser: false,
        isLastAssistantInTurn: true,
        error: { name: "AbortError", message: "This operation was aborted" },
      }),
    ).toEqual({
      text: "The running turn was stopped before AX Code could send the next message.",
      variant: "info",
    })
  })

  test("recognizes the transport cancellation message even without AbortError", () => {
    expect(
      getAssistantErrorPresentation({
        isUser: false,
        isLastAssistantInTurn: true,
        error: { message: "This operation was aborted" },
      }),
    ).toMatchObject({ variant: "info" })
  })

  test("does not render an error presentation for user messages", () => {
    expect(
      getAssistantErrorPresentation({
        isUser: true,
        isLastAssistantInTurn: true,
        error: { message: "request failed" },
      }),
    ).toBeUndefined()
  })
})
