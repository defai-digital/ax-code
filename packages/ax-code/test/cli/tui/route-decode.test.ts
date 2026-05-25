import { describe, expect, test } from "bun:test"
import { parseInitialRoutePayload } from "../../../src/cli/cmd/tui/context/route-util"

describe("tui initial route decoding", () => {
  test("parses home routes with validated initial prompts", () => {
    expect(
      parseInitialRoutePayload(
        JSON.stringify({
          type: "home",
          workspaceID: "wrk_1",
          initialPrompt: { input: "hello", parts: [{ type: "text", text: "hello" }] },
        }),
      ),
    ).toEqual({
      type: "home",
      workspaceID: "wrk_1",
      initialPrompt: { input: "hello", parts: [{ type: "text", text: "hello" }] },
    })
  })

  test("drops malformed initial prompts without dropping the route", () => {
    expect(
      parseInitialRoutePayload(
        JSON.stringify({
          type: "session",
          sessionID: "ses_1",
          initialPrompt: { input: "hello", parts: [{ text: "missing type" }] },
        }),
      ),
    ).toEqual({
      type: "session",
      sessionID: "ses_1",
      initialPrompt: undefined,
    })
  })

  test("falls back to home for malformed route payloads", () => {
    expect(parseInitialRoutePayload("not json")).toEqual({ type: "home" })
    expect(parseInitialRoutePayload(JSON.stringify({ type: "session", sessionID: 1 }))).toEqual({ type: "home" })
    expect(parseInitialRoutePayload(undefined)).toEqual({ type: "home" })
  })
})
