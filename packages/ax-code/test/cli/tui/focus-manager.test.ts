import { describe, expect, test } from "bun:test"
import { blocksPromptInput, resolveFocusOwner } from "../../../src/cli/cmd/tui/input/focus-manager"

describe("tui focus manager", () => {
  test("gives modal prompts priority over prompt focus", () => {
    expect(
      resolveFocusOwner({
        prompt: { visible: true },
        permissionSessionID: "ses_1",
        dialog: "workspace",
      }),
    ).toEqual({ type: "permission", sessionID: "ses_1" })

    expect(
      resolveFocusOwner({
        prompt: { visible: true },
        questionSessionID: "ses_1",
        permissionSessionID: "ses_1",
      }),
    ).toEqual({ type: "question", sessionID: "ses_1" })
  })

  test("keeps command and workspace dialogs ahead of selection and prompt", () => {
    expect(
      resolveFocusOwner({
        prompt: { visible: true },
        selection: "transcript",
        dialog: "command",
      }),
    ).toEqual({ type: "dialog", dialog: "command" })

    expect(
      resolveFocusOwner({
        prompt: { visible: true },
        dialog: "workspace",
      }),
    ).toEqual({ type: "dialog", dialog: "workspace" })
  })

  test("falls back through selection, prompt, and app in order", () => {
    expect(
      resolveFocusOwner({
        prompt: { visible: true },
        selection: "transcript",
      }),
    ).toEqual({ type: "selection", target: "transcript" })

    expect(
      resolveFocusOwner({
        prompt: { visible: true },
      }),
    ).toEqual({ type: "prompt" })

    expect(
      resolveFocusOwner({
        prompt: { visible: false },
      }),
    ).toEqual({ type: "app" })
  })

  test("reports when prompt input should be blocked", () => {
    expect(blocksPromptInput({ type: "prompt" })).toBe(false)
    expect(blocksPromptInput({ type: "dialog", dialog: "workspace" })).toBe(true)
  })
})
