import { describe, expect, test } from "vitest"
import { buildMiniChatMainHandoffPayload } from "./miniChatMainHandoff"

describe("buildMiniChatMainHandoffPayload", () => {
  test("prefers the active open directory when focusing a session from mini-chat", () => {
    expect(
      buildMiniChatMainHandoffPayload({
        currentSessionId: "ses_123",
        openDirectory: "/repo/.worktrees/feature",
        sessionDirectory: "/repo",
        currentDirectory: "/repo",
      }),
    ).toEqual({
      sessionId: "ses_123",
      directory: "/repo/.worktrees/feature",
    })
  })

  test("falls back through session and current directories for session handoff", () => {
    expect(
      buildMiniChatMainHandoffPayload({
        currentSessionId: "ses_123",
        openDirectory: "",
        sessionDirectory: "/repo",
        currentDirectory: "/fallback",
      }),
    ).toEqual({
      sessionId: "ses_123",
      directory: "/repo",
    })
  })

  test("builds a draft handoff payload when no session is selected", () => {
    expect(
      buildMiniChatMainHandoffPayload({
        openDirectory: " /repo ",
        currentDirectory: "/fallback",
        draftProjectId: " project-1 ",
      }),
    ).toEqual({
      mode: "draft",
      directory: "/repo",
      projectId: "project-1",
    })
  })
})
