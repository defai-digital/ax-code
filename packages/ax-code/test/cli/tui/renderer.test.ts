import { describe, expect, test } from "bun:test"
import {
  createTuiRenderOptions,
  TUI_RENDER_COPY_SELECTION_KEY_BINDING,
  TUI_RENDER_TARGET_FPS,
} from "../../../src/cli/cmd/tui/renderer"

describe("tui renderer adapter", () => {
  test("centralizes OpenTUI render options", () => {
    const onCopySelection = () => {}
    const options = createTuiRenderOptions({ onCopySelection })

    expect(options).toMatchObject({
      targetFps: TUI_RENDER_TARGET_FPS,
      gatherStats: false,
      exitOnCtrlC: false,
      useKittyKeyboard: {},
      autoFocus: false,
      openConsoleOnError: false,
      externalOutputMode: "passthrough",
    })
    expect(options.consoleOptions?.keyBindings).toEqual([TUI_RENDER_COPY_SELECTION_KEY_BINDING])
    expect(options.consoleOptions?.onCopySelection).toBe(onCopySelection)
  })

  test("keeps selection copy delegated to the caller", async () => {
    const copied: string[] = []
    const options = createTuiRenderOptions({
      onCopySelection: async (text) => {
        copied.push(text)
      },
    })

    await options.consoleOptions?.onCopySelection?.("selected text")

    expect(copied).toEqual(["selected text"])
  })
})
