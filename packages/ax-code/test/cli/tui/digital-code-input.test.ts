import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot, onCleanup } from "solid-js"
import { InternalKeyHandler, KeyEvent, PasteEvent, parseKeypress } from "ax-tui"

vi.mock("solid-js", async () => {
  const { createRequire } = await import("node:module")
  return createRequire(import.meta.url)("solid-js/dist/solid.cjs") as typeof import("solid-js")
})
const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  tick: undefined as undefined | (() => void),
  renderer: undefined as unknown as {
    keyInput: InternalKeyHandler
    hasSelection: boolean
    addPostProcessFn: ReturnType<typeof vi.fn>
    removePostProcessFn: ReturnType<typeof vi.fn>
    requestRender: ReturnType<typeof vi.fn>
    setCursorPosition: ReturnType<typeof vi.fn>
  },
}))
vi.mock("ax-tui", async (original) => ({
  ...(await original<typeof import("ax-tui")>()),
  resolveRenderLib: () => ({ writeOut: mocks.write }),
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
  scheduleTuiInterval: (callback: () => void) => {
    mocks.tick = callback
    return () => {}
  },
  scheduleTuiTimeout: () => () => {},
}))
import { DigitalCode } from "../../../src/cli/tui/component/digital-code"

let dispose: () => void
beforeEach(() => {
  mocks.write.mockClear()
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
async function mount(
  captureInput = true,
  style:
    | "digital-code"
    | "classic-foliage"
    | "golden-foliage"
    | "midnight-dream"
    | "sunset-serenade"
    | "fuji-day"
    | "mahjong-match"
    | "mahjong-ending"
    | "fuji-night" = "digital-code",
) {
  const onDone = vi.fn()
  createRoot((cleanup) => {
    dispose = cleanup
    DigitalCode({ captureInput, onDone, style })
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

test.each([
  "digital-code",
  "fuji-day",
  "fuji-night",
  "midnight-dream",
  "sunset-serenade",
  "mahjong-match",
  "mahjong-ending",
] as const)("%s pixel playback deletes its image on skip before unmount", async (style) => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
  try {
    Object.assign(mocks.renderer, {
      resolution: { width: 320, height: 180 },
      screenMode: "alternate-screen",
      capabilities: { kitty_graphics: true, remote: false, multiplexer: "none" },
      rendererPtr: 1,
      isDestroyed: false,
    })
    const done = await mount(true, style)
    mocks.tick!()
    expect(mocks.write).toHaveBeenCalledTimes(1)
    mocks.renderer.keyInput.emit("keypress", key("\x1b"))
    expect(done).toHaveBeenCalledWith("skip")
    expect(mocks.write).toHaveBeenCalledTimes(2)
    expect(mocks.write.mock.calls[1]![1]).toContain("a=d,d=I")
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor)
    else Reflect.deleteProperty(process.stdout, "isTTY")
  }
})

test("pixel playback deletes its image when the overlay unmounts", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
  try {
    Object.assign(mocks.renderer, {
      resolution: { width: 320, height: 180 },
      screenMode: "alternate-screen",
      capabilities: { kitty_graphics: true, remote: false, multiplexer: "none" },
      rendererPtr: 1,
      isDestroyed: false,
    })
    await mount()
    mocks.tick!()
    expect(mocks.write).toHaveBeenCalledTimes(1)
    expect(mocks.write.mock.calls[0]![1]).toContain("a=T,f=24")
    dispose()
    expect(mocks.write).toHaveBeenCalledTimes(2)
    expect(mocks.write.mock.calls[1]![1]).toContain("a=d,d=I")
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor)
    else Reflect.deleteProperty(process.stdout, "isTTY")
  }
})

test.each([
  "classic-foliage",
  "golden-foliage",
  "midnight-dream",
  "sunset-serenade",
  "fuji-day",
  "fuji-night",
  "mahjong-match",
  "mahjong-ending",
] as const)("%s consumes exit input and restores handlers on cleanup", async (style) => {
  const prompt = vi.fn()
  mocks.renderer.keyInput.onInternal("keypress", prompt)
  const done = await mount(true, style)
  mocks.tick!()
  mocks.renderer.keyInput.emit("keypress", key("\x1b"))
  expect(done).toHaveBeenCalledWith("skip")
  expect(prompt).not.toHaveBeenCalled()
  dispose()
  mocks.renderer.keyInput.emit("keypress", key("a"))
  expect(prompt).toHaveBeenCalledTimes(1)
})

test.each(["unsupported", "remote", "multiplexer", "missing-resolution"])(
  "Fuji uses text fallback for %s",
  async (condition) => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
    try {
      Object.assign(mocks.renderer, {
        resolution: condition === "missing-resolution" ? undefined : { width: 320, height: 180 },
        screenMode: "alternate-screen",
        capabilities: {
          kitty_graphics: condition !== "unsupported",
          remote: condition === "remote",
          multiplexer: condition === "multiplexer" ? "tmux" : "none",
        },
        rendererPtr: 1,
        isDestroyed: false,
      })
      const done = await mount(true, "fuji-day")
      mocks.tick!()
      expect(mocks.write).not.toHaveBeenCalled()
      mocks.renderer.keyInput.emit("keypress", key("\x1b"))
      expect(done).toHaveBeenCalledWith("skip")
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor)
      else Reflect.deleteProperty(process.stdout, "isTTY")
    }
  },
)

test("Fuji deletes the image when graphics capability disappears and resumes when restored", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
  try {
    const capabilities = { kitty_graphics: true, remote: false, multiplexer: "none" }
    Object.assign(mocks.renderer, {
      resolution: { width: 320, height: 180 },
      screenMode: "alternate-screen",
      capabilities,
      rendererPtr: 1,
      isDestroyed: false,
    })
    await mount(true, "fuji-night")
    mocks.tick!()
    expect(mocks.write.mock.calls[0]![1]).toContain("a=T,f=24")
    capabilities.kitty_graphics = false
    mocks.tick!()
    expect(mocks.write.mock.calls[1]![1]).toContain("a=d,d=I")
    mocks.tick!()
    expect(mocks.write).toHaveBeenCalledTimes(2)
    capabilities.kitty_graphics = true
    mocks.tick!()
    expect(mocks.write.mock.calls[2]![1]).toContain("a=T,f=24")
    dispose()
    expect(mocks.write.mock.calls[3]![1]).toContain("a=d,d=I")
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor)
    else Reflect.deleteProperty(process.stdout, "isTTY")
  }
})

test("failed native image output falls back once without sending frames through stdout", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true)
  try {
    Object.assign(mocks.renderer, {
      resolution: { width: 320, height: 180 },
      screenMode: "alternate-screen",
      capabilities: { kitty_graphics: true, remote: false, multiplexer: "none" },
      rendererPtr: 1,
      isDestroyed: false,
    })
    mocks.write.mockImplementation((_ptr, data: string) => {
      if (data.includes("a=T,f=24")) throw new Error("native output unavailable")
    })
    await mount(true, "mahjong-match")
    mocks.tick!()
    mocks.tick!()
    expect(mocks.write.mock.calls.filter((call) => call[1].includes("a=T,f=24"))).toHaveLength(1)
    expect(mocks.write.mock.calls.some((call) => call[1].includes("a=d,d=I"))).toBe(true)
    expect(stdout).not.toHaveBeenCalled()
  } finally {
    mocks.write.mockReset()
    stdout.mockRestore()
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor)
    else Reflect.deleteProperty(process.stdout, "isTTY")
  }
})

test("a queued animation tick cannot recreate an image after unmount", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
  try {
    Object.assign(mocks.renderer, {
      resolution: { width: 320, height: 180 },
      screenMode: "alternate-screen",
      capabilities: { kitty_graphics: true, remote: false, multiplexer: "none" },
      rendererPtr: 1,
      isDestroyed: false,
    })
    await mount(true, "fuji-night")
    mocks.tick!()
    dispose()
    const count = mocks.write.mock.calls.length
    mocks.tick!()
    expect(mocks.write).toHaveBeenCalledTimes(count)
  } finally {
    if (descriptor) Object.defineProperty(process.stdout, "isTTY", descriptor)
    else Reflect.deleteProperty(process.stdout, "isTTY")
  }
})
