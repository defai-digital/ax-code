import { beforeEach, describe, expect, test, vi } from "vitest"
import { useWorkModeStore } from "@/stores/useWorkModeStore"
import { resolveWorkModeSend, routeWorkModeInput } from "@/lib/workMode"

/**
 * Pure routing contract used by session-ui-store routeMessage.
 * Full routeMessage is heavy (SDK); this locks the remap behavior.
 */
describe("work mode send routing contract", () => {
  beforeEach(() => {
    useWorkModeStore.setState({ modeByDirectory: {} })
  })

  test("agent mode does not rewrite free text", () => {
    useWorkModeStore.getState().setMode("/proj", "agent")
    const mode = useWorkModeStore.getState().getMode("/proj")
    expect(routeWorkModeInput(mode, "fix the bug")).toEqual({
      kind: "prompt",
      text: "fix the bug",
    })
  })

  test("council mode maps free text to council command", () => {
    useWorkModeStore.getState().setMode("/proj", "council")
    const mode = useWorkModeStore.getState().getMode("/proj")
    const routed = routeWorkModeInput(mode, "rate code quality")
    expect(routed).toEqual({
      kind: "command",
      command: "council",
      arguments: "rate code quality",
    })
  })

  test("explicit slash is never rewritten", () => {
    useWorkModeStore.getState().setMode("/proj", "arena")
    const mode = useWorkModeStore.getState().getMode("/proj")
    expect(routeWorkModeInput(mode, "/help")).toEqual({ kind: "prompt", text: "/help" })
  })

  test("leading whitespace does not bypass slash or work-mode routing", () => {
    useWorkModeStore.getState().setMode("/proj", "council")
    const mode = useWorkModeStore.getState().getMode("/proj")
    expect(resolveWorkModeSend(mode, "  /help")).toEqual({
      content: "/help",
      forcedCommand: null,
    })
    expect(resolveWorkModeSend(mode, "  review this")).toEqual({
      content: "/council review this",
      forcedCommand: { name: "council", arguments: "review this" },
    })
  })
})

void vi
