import { describe, expect, test } from "vitest"

import { getAssistantErrorPresentation } from "./assistantErrorPresentation"

describe("getAssistantErrorPresentation", () => {
  test("shows a non-terminal recovery notice when a later assistant attempt exists", () => {
    expect(
      getAssistantErrorPresentation({
        isUser: false,
        isLastAssistantInTurn: false,
        error: { name: "APIError", data: { message: "invalid access token or token expired" } },
      }),
    ).toEqual({
      text: "This attempt did not complete. AX Code is continuing the same request automatically.",
      variant: "info",
    })
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
