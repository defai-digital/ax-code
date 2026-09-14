import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, onCleanup } from "solid-js"
import { InternalKeyHandler, KeyEvent, PasteEvent, parseKeypress } from "ax-tui"

vi.mock("solid-js", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("solid-js/dist/solid.cjs") as typeof import("solid-js")
})
const mocks = vi.hoisted(() => ({
  renderer: undefined as unknown as {
    keyInput: InternalKeyHandler
    hasSelection: boolean
    addPostProcessFn: ReturnType<typeof vi.fn>
    removePostProcessFn: ReturnType<typeof vi.fn>
    requestRender: ReturnType<typeof vi.fn>
    setCursorPosition: ReturnType<typeof vi.fn>
  },
}))
vi.mock("ax-tui/solid", () => ({
  useRenderer: () => mocks.renderer,
  useTerminalDimensions: () => () => ({ width: 10, height: 5 }),
  useKeyboard: (handler: (event: KeyEvent) => void) => {
    mocks.renderer.keyInput.on("keypress", handler)
    onCleanup(() => mocks.renderer.keyInput.off("keypress", handler))
  },
}))
vi.mock("@tui/util/timer", () => ({
  scheduleTuiInterval: () => () => {},
  scheduleTuiTimeout: () => () => {},
}))
import { MatrixRain } from "../../../src/cli/cmd/tui/component/matrix-rain"

let dispose: () => void
beforeEach(() => {
  mocks.renderer = {
    keyInput: new InternalKeyHandler(),
    hasSelection: false,
    addPostProcessFn: vi.fn(),
    removePostProcessFn: vi.fn(),
    requestRender: vi.fn(),
    setCursorPosition: vi.fn(),
  }
  vi.stubGlobal("React", { createElement: () => undefined })
})
afterEach(() => {
  dispose?.()
  vi.unstubAllGlobals()
})
async function mount(captureInput = true) {
  const onDone = vi.fn()
  createRoot((cleanup) => {
    dispose = cleanup
    MatrixRain({ captureInput, onDone })
  })
  await Promise.resolve()
  return onDone
}
function key(raw: string) {
  return new KeyEvent(parseKeypress(raw)!)
}

describe("ending rain input admission", () => {
  test("blocks already registered global shortcuts and prompt input", async () => {
    const shortcut = vi.fn()
    const prompt = vi.fn()
    mocks.renderer.keyInput.on("keypress", shortcut)
    mocks.renderer.keyInput.onInternal("keypress", prompt)
    await mount()
    mocks.renderer.keyInput.emit("keypress", key("\r"))
    expect(shortcut).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
  })
  test("blocks paste and key release before existing handlers", async () => {
    const paste = vi.fn()
    const release = vi.fn()
    mocks.renderer.keyInput.on("paste", paste)
    mocks.renderer.keyInput.on("keyrelease", release)
    await mount()
    mocks.renderer.keyInput.emit("paste", new PasteEvent(Buffer.from("new work")))
    mocks.renderer.keyInput.emit("keyrelease", key("a"))
    expect(paste).not.toHaveBeenCalled()
    expect(release).not.toHaveBeenCalled()
  })
  test.each(["\x03", "\x1b"])("dismissal consumes %j before a global shortcut", async (raw) => {
    const shortcut = vi.fn()
    mocks.renderer.keyInput.on("keypress", shortcut)
    const done = await mount()
    mocks.renderer.keyInput.emit("keypress", key(raw))
    expect(done).toHaveBeenCalledWith("skip")
    expect(shortcut).not.toHaveBeenCalled()
  })
  test("an existing selection cannot admit input while exiting", async () => {
    mocks.renderer.hasSelection = true
    const prompt = vi.fn()
    mocks.renderer.keyInput.onInternal("keypress", prompt)
    await mount()
    mocks.renderer.keyInput.emit("keypress", key("a"))
    expect(prompt).not.toHaveBeenCalled()
  })
  test("unmount restores keyboard and paste delivery", async () => {
    const shortcut = vi.fn()
    const paste = vi.fn()
    mocks.renderer.keyInput.on("keypress", shortcut)
    mocks.renderer.keyInput.on("paste", paste)
    await mount()
    dispose()
    mocks.renderer.keyInput.emit("keypress", key("a"))
    mocks.renderer.keyInput.emit("paste", new PasteEvent(Buffer.from("restored")))
    expect(shortcut).toHaveBeenCalledTimes(1)
    expect(paste).toHaveBeenCalledTimes(1)
    expect(mocks.renderer.keyInput.listenerCount("keyrelease")).toBe(0)
  })
  test("opening rain preserves ordinary prompt input", async () => {
    const prompt = vi.fn()
    mocks.renderer.keyInput.onInternal("keypress", prompt)
    await mount(false)
    mocks.renderer.keyInput.emit("keypress", key("a"))
    expect(prompt).toHaveBeenCalledTimes(1)
  })
})
