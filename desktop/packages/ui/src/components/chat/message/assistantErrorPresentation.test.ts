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
