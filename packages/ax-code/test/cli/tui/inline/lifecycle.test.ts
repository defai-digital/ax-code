import { afterEach, describe, expect, test, vi } from "vitest"
import type { CliRenderer } from "ax-tui"
import {
  createInlineLifecycle,
  inlineFooterHeight,
  inlineRenderOptions,
} from "../../../../src/cli/tui/inline/lifecycle"
import { resolveTuiRenderProfile } from "../../../../src/cli/tui/renderer"
import { resetActiveTuiTerminal, setTuiTerminalProfile } from "../../../../src/cli/tui/util/lifecycle"

const profile = resolveTuiRenderProfile({ advancedTerminal: false, terminalTitleDisabled: true, screenFlag: "inline" })
afterEach(() => {
  vi.restoreAllMocks()
  setTuiTerminalProfile({ screenMode: "main-screen", useKittyKeyboard: true })
})

function fixture(failCapture = false) {
  const events: string[] = []
  const bytes: string[] = []
  const listeners = new Set<() => void>()
  const renderer = {
    terminalHeight: 24,
    footerHeight: 4,
    isDestroyed: false,
    on(_event: string, callback: () => void) {
      listeners.add(callback)
    },
    off(_event: string, callback: () => void) {
      listeners.delete(callback)
    },
    set externalOutputMode(mode: string) {
      events.push(mode)
      if (failCapture) throw new Error("capture failure")
    },
    set screenMode(mode: string) {
      events.push(mode)
    },
    destroy() {
      events.push("destroy")
      this.isDestroyed = true
    },
  }
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string, callback?: () => void) => {
    bytes.push(chunk)
    callback?.()
    return true
  }) as typeof process.stdout.write)
  return { renderer: renderer as unknown as CliRenderer, events, bytes, listeners }
}

describe("inline lifecycle", () => {
  test("app owns signal teardown so native destruction cannot preempt drain", () => {
    expect(inlineRenderOptions().exitSignals).toEqual([])
  })

  test("flushes before capture stop, mode transition, destruction and a fresh line", async () => {
    const { renderer, events, bytes, listeners } = fixture()
    const barrier = Promise.withResolvers<void>()
    const lifecycle = createInlineLifecycle(renderer, profile, async () => {
      events.push("flush")
      await barrier.promise
    })
    const close = lifecycle.close()
    expect(events).toEqual(["flush"])
    barrier.resolve()
    await close
    await lifecycle.close()
    expect(events).toEqual(["flush", "passthrough", "main-screen", "destroy"])
    expect(bytes.join("")).not.toMatch(/\x1b\[2J|\x1b\[\?1049l/)
    expect(bytes.join("")).toContain("\r\n")
    expect(listeners.size).toBe(0)
  })

  test("crash cleanup uses the mounted profile rather than environment inference", async () => {
    const { renderer, events, bytes } = fixture()
    createInlineLifecycle(renderer, profile, async () => {
      events.push("flush")
    })
    await resetActiveTuiTerminal()
    expect(events).toEqual(["flush", "passthrough", "main-screen", "destroy"])
    expect(bytes.join("")).not.toMatch(/\x1b\[2J|\x1b\[\?1049l/)
  })

  test("a failed capture transition does not skip destruction", async () => {
    const { renderer, events } = fixture(true)
    const lifecycle = createInlineLifecycle(renderer, profile, async () => {})
    await expect(lifecycle.close()).rejects.toThrow("capture failure")
    expect(events).toEqual(["passthrough", "main-screen", "destroy"])
  })

  test("resize clamps multi-line drafts to six rows and leaves a transcript row", async () => {
    const { renderer, listeners } = fixture()
    const lifecycle = createInlineLifecycle(renderer, profile, async () => {})
    lifecycle.resize(20)
    expect(renderer.footerHeight).toBe(6)
    Object.defineProperty(renderer, "terminalHeight", { value: 4 })
    for (const listener of listeners) listener()
    expect(renderer.footerHeight).toBe(3)
    expect(inlineFooterHeight(1, 24)).toBe(4)
    await lifecycle.close()
  })
})
