import { afterEach, describe, expect, test, vi } from "vitest"

const mocked = vi.hoisted(() => ({
  render: vi.fn(async (..._args: unknown[]) => undefined),
  flag: {
    AX_CODE_TUI_ADVANCED_TERMINAL: false,
    AX_CODE_DISABLE_TERMINAL_TITLE: false,
    AX_CODE_TUI_KITTY_KEYBOARD: true,
    AX_CODE_TUI_MODIFY_OTHER_KEYS: true,
  },
}))

vi.mock("ax-tui/solid", () => ({ render: mocked.render }))
vi.mock("@/flag/flag", () => ({ Flag: mocked.flag }))

import { renderTui, type TuiRenderRoot } from "../../../src/cli/cmd/tui/renderer"
import { TUI_MODIFY_OTHER_KEYS_ENABLE_SEQUENCE } from "../../../src/cli/cmd/tui/terminal-cleanup"

const originalWrite = process.stdout.write
const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
const root = (() => undefined) as unknown as TuiRenderRoot

afterEach(() => {
  process.stdout.write = originalWrite
  if (originalIsTTY) {
    Object.defineProperty(process.stdout, "isTTY", originalIsTTY)
  } else {
    delete (process.stdout as { isTTY?: boolean }).isTTY
  }
  mocked.render.mockClear()
  mocked.flag.AX_CODE_TUI_ADVANCED_TERMINAL = false
  mocked.flag.AX_CODE_TUI_KITTY_KEYBOARD = true
  mocked.flag.AX_CODE_TUI_MODIFY_OTHER_KEYS = true
})

function captureProtocolWrites() {
  const writes: string[] = []
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
  process.stdout.write = ((chunk: string) => {
    writes.push(chunk)
    return true
  }) as typeof process.stdout.write
  return writes
}

describe("renderTui keyboard protocol setup", () => {
  test("enables modifyOtherKeys and delegates Kitty CSI-u to the renderer", async () => {
    const writes = captureProtocolWrites()

    const rendered = renderTui(root)
    // Native setup runs first and may set mode 1; AX Code reasserts mode 2 only
    // after render setup resolves.
    expect(writes).toEqual([])
    await rendered

    expect(writes).toEqual([TUI_MODIFY_OTHER_KEYS_ENABLE_SEQUENCE])
    expect(mocked.render).toHaveBeenCalledOnce()
    expect(mocked.render.mock.calls[0]?.[1]).toMatchObject({
      screenMode: "main-screen",
      useKittyKeyboard: {},
    })
  })

  test("uses the same protocol ownership in the advanced profile", async () => {
    mocked.flag.AX_CODE_TUI_ADVANCED_TERMINAL = true
    const writes = captureProtocolWrites()

    await renderTui(root)

    expect(writes).toEqual([TUI_MODIFY_OTHER_KEYS_ENABLE_SEQUENCE])
    expect(mocked.render.mock.calls[0]?.[1]).toMatchObject({
      screenMode: "alternate-screen",
      useKittyKeyboard: {},
    })
  })

  test("honors both explicit keyboard protocol opt-outs", async () => {
    mocked.flag.AX_CODE_TUI_KITTY_KEYBOARD = false
    mocked.flag.AX_CODE_TUI_MODIFY_OTHER_KEYS = false
    const writes = captureProtocolWrites()

    await renderTui(root)

    expect(writes).toEqual([])
    expect(mocked.render.mock.calls[0]?.[1]).toMatchObject({ useKittyKeyboard: null })
  })
})
