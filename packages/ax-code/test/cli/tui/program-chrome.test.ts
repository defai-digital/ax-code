import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { CHROME_CLEAR_SEQUENCE } from "@ax-code/akitty-sdk"
import {
  TUI_PROGRAM_CHROME_ANIMATIONS,
  createTuiProgramChrome,
  disposeTuiProgramChrome,
  supportsTuiProgramChrome,
  suspendTuiProgramChrome,
  updateTuiProgramChrome,
} from "../../../src/cli/tui/program-chrome"
import { destroyTuiRenderer, resolveTuiRenderProfile, setTuiProgramChrome } from "../../../src/cli/tui/renderer"
import { createTuiTerminalCrashResetSequence, resetTuiTerminalState } from "../../../src/cli/tui/terminal-cleanup"
import { AKITTY_PIXEL_PALETTE, AKITTY_PIXEL_PX } from "../../../src/cli/tui/akitty-pixel"
import { registerTuiSequenceTarget, unregisterTuiSequenceTarget } from "../../../src/cli/tui/util/sequence-writer"

const busy = { enabled: true, busy: true, animations: true, statusText: "Working" }
const env = { TERM_PROGRAM: "Akitty", TERM: "xterm-256color" }
const profile = resolveTuiRenderProfile({ advancedTerminal: true, terminalTitleDisabled: false })
const parse = (sequence: string) => JSON.parse(sequence.slice("\x1b]771;".length, -1))
const [CAT, CHICK, RED_PANDA, DRAGON, DOG] = TUI_PROGRAM_CHROME_ANIMATIONS
const TUI_PROGRAM_CHROME_FRAME_MS = CAT.frameMs
// The frame a chrome write shows, and the cat frame expected at an index.
// Some poses repeat, so compare pixels rather than look up an index.
const shown = (sequence: string) => parse(sequence).sprite.frames[0]
const frame = (index: number) => CAT.sprites[index % CAT.sprites.length]!.frames[0]

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  disposeTuiProgramChrome()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

// Random 0 picks the cat, so frame expectations stay deterministic.
function harness(random: () => number = () => 0) {
  const writes: string[] = []
  const onError = vi.fn()
  const controller = createTuiProgramChrome({
    supported: true,
    random,
    write: (sequence) => {
      writes.push(sequence)
      return true
    },
    onError,
  })
  return { writes, onError, controller }
}

describe("AkiTTY program chrome", () => {
  test.each(["idle", "disabled", "disposed"])("editor return does not revive %s chrome", (transition) => {
    const writes: string[] = []
    const options = {
      owner: writes,
      env,
      isTTY: true,
      write: (sequence: string) => {
        writes.push(sequence)
        return true
      },
      onError: vi.fn(),
    }
    updateTuiProgramChrome(busy, options)
    const resume = suspendTuiProgramChrome()
    expect(writes.at(-1)).toBe(CHROME_CLEAR_SEQUENCE)
    if (transition === "disposed") disposeTuiProgramChrome()
    else updateTuiProgramChrome({ ...busy, busy: transition !== "idle", enabled: transition !== "disabled" }, options)
    const count = writes.length
    vi.advanceTimersByTime(1000)
    resume()
    resume()
    vi.advanceTimersByTime(1000)
    expect(writes).toHaveLength(count)
  })

  test("nested terminal handoffs restore the latest status only after both return", () => {
    const writes: string[] = []
    const options = {
      owner: writes,
      env,
      isTTY: true,
      write: (sequence: string) => {
        writes.push(sequence)
        return true
      },
      onError: vi.fn(),
    }
    updateTuiProgramChrome(busy, options)
    const outer = suspendTuiProgramChrome()
    const inner = suspendTuiProgramChrome()
    updateTuiProgramChrome({ ...busy, statusText: "Retrying", animations: false }, options)
    const count = writes.length
    outer()
    vi.advanceTimersByTime(1000)
    expect(writes).toHaveLength(count)
    inner()
    expect(parse(writes.at(-1)!)).toMatchObject({ status: { text: "Retrying" }, mark: 0 })
    const resumed = writes.length
    vi.advanceTimersByTime(1000)
    expect(writes).toHaveLength(resumed)
  })

  test("busy sessions show localized status, progress and an A/X sprite while updates deduplicate", () => {
    const { writes, controller } = harness()
    expect(controller.update({ ...busy, statusText: "處理中" })).toBe(true)
    const initial = parse(writes.at(-1)!)
    expect(initial.status).toEqual({ text: "處理中", tone: "info" })
    expect(initial.progress).toBe("indeterminate")
    expect(initial.sprite).toMatchObject({ w: AKITTY_PIXEL_PX, h: AKITTY_PIXEL_PX })
    expect(initial.sprite.frames).toHaveLength(1)
    expect(initial.mark).toBe(0)
    expect(shown(writes.at(-1)!)).toBe(frame(0))
    expect(controller.update({ ...busy, statusText: "處理中" })).toBe(false)
    vi.advanceTimersByTime(TUI_PROGRAM_CHROME_FRAME_MS)
    expect(shown(writes.at(-1)!)).toBe(frame(1))
    expect(parse(writes.at(-1)!).status.text).toBe("處理中")
    controller.update({ ...busy, statusText: "Retrying" })
    expect(parse(writes.at(-1)!).status.text).toBe("Retrying")
    controller.dispose()
  })

  const colors = (frame: string) => {
    const pixels = Buffer.from(frame, "base64")
    expect(pixels).toHaveLength(AKITTY_PIXEL_PX * AKITTY_PIXEL_PX * 4)
    const set = new Set<string>()
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3]) set.add([...pixels.subarray(i, i + 3)].join(","))
    return set
  }
  const rgb = (name: keyof typeof AKITTY_PIXEL_PALETTE) => AKITTY_PIXEL_PALETTE[name].join(",")

  test.each(TUI_PROGRAM_CHROME_ANIMATIONS.map((animation) => [animation.name, animation] as const))(
    "the %s plays a 15 s loop of crisp, never-empty pixel art",
    (_, animation) => {
      const frames = animation.sprites.map((sprite) => sprite.frames[0]!)
      expect(frames.length * animation.frameMs).toBe(15_000)
      expect(new Set(frames).size).toBeGreaterThanOrEqual(30)
      const palette = new Set(
        Object.keys(AKITTY_PIXEL_PALETTE).map((name) => rgb(name as keyof typeof AKITTY_PIXEL_PALETTE)),
      )
      for (const frame of frames) {
        const used = colors(frame)
        // Something is always on screen, even while crossing an edge.
        expect(used.size).toBeGreaterThan(0)
        for (const color of used) expect(palette.has(color)).toBe(true)
        // Every pixel is fully opaque or fully transparent.
        const pixels = Buffer.from(frame, "base64")
        for (let i = 3; i < pixels.length; i += 4) expect([0, 255]).toContain(pixels[i])
      }
    },
  )

  test("the cat is white, black and orange and ends on the icon's wink", () => {
    const used = new Set(CAT.sprites.flatMap((sprite) => [...colors(sprite.frames[0]!)]))
    expect(used).toEqual(new Set([rgb("white"), rgb("black"), rgb("orange")]))
    const wink = Buffer.from(CAT.sprites.at(-1)!.frames[0]!, "base64")
    const at = (x: number, y: number) =>
      [...wink.subarray((y * AKITTY_PIXEL_PX + x) * 4, (y * AKITTY_PIXEL_PX + x) * 4 + 3)].join(",")
    expect([at(9, 10), at(10, 11), at(9, 12)]).toEqual([rgb("black"), rgb("black"), rgb("black")])
  })

  test("the chick hatches from its egg and tucks back in, so the loop is seamless", () => {
    // The loop opens and closes on the white egg.
    const egg = new Set([rgb("white"), rgb("black")])
    expect(colors(CHICK.sprites[0]!.frames[0]!)).toEqual(egg)
    expect(colors(CHICK.sprites.at(-1)!.frames[0]!)).toEqual(egg)
    expect(CHICK.sprites.at(-1)!.frames[0]).toBe(CHICK.sprites[0]!.frames[0])
    // In between it is a yellow chick with an orange beak and feet.
    const used = new Set(CHICK.sprites.flatMap((sprite) => [...colors(sprite.frames[0]!)]))
    expect(used).toEqual(new Set([rgb("yellow"), rgb("black"), rgb("orange"), rgb("white")]))
    // Its moves are its own: no frame repeats one of the cat's.
    const cat = new Set(CAT.sprites.map((sprite) => sprite.frames[0]))
    expect(CHICK.sprites.some((sprite) => cat.has(sprite.frames[0]))).toBe(false)
  })

  test("the red panda is rust with a white mask, black legs, a ringed tail and green bamboo", () => {
    const used = new Set(RED_PANDA.sprites.flatMap((sprite) => [...colors(sprite.frames[0]!)]))
    expect(used).toEqual(new Set([rgb("rust"), rgb("white"), rgb("black"), rgb("orange"), rgb("green")]))
    // Its moves are its own: no frame repeats the cat's or the chick's.
    const others = new Set([...CAT.sprites, ...CHICK.sprites].map((sprite) => sprite.frames[0]))
    expect(RED_PANDA.sprites.some((sprite) => others.has(sprite.frames[0]))).toBe(false)
  })

  test("the dragon is green, white and orange, and its moves are its own", () => {
    const used = new Set(DRAGON.sprites.flatMap((sprite) => [...colors(sprite.frames[0]!)]))
    expect(used).toEqual(new Set([rgb("green"), rgb("white"), rgb("orange"), rgb("black")]))
    const others = new Set([...CAT.sprites, ...CHICK.sprites, ...RED_PANDA.sprites].map((sprite) => sprite.frames[0]))
    expect(DRAGON.sprites.some((sprite) => others.has(sprite.frames[0]))).toBe(false)
  })

  test("the dog is a silver and white husky with a blue collar that runs the widest", () => {
    const used = new Set(DOG.sprites.flatMap((sprite) => [...colors(sprite.frames[0]!)]))
    expect(used).toEqual(new Set([rgb("silver"), rgb("white"), rgb("black"), rgb("blue"), rgb("yellow")]))
    const others = new Set(
      [...CAT.sprites, ...CHICK.sprites, ...RED_PANDA.sprites, ...DRAGON.sprites].map((sprite) => sprite.frames[0]),
    )
    expect(DOG.sprites.some((sprite) => others.has(sprite.frames[0]))).toBe(false)
    // Count frames where the animal has mostly left the frame: the dog's runs
    // go further out, and more often, than the cat's walk.
    const offstage = (animal: typeof CAT) =>
      animal.sprites.filter((sprite) => {
        const pixels = Buffer.from(sprite.frames[0]!, "base64")
        let lit = 0
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) lit++
        return lit < 40
      }).length
    expect(offstage(DOG)).toBeGreaterThan(offstage(CAT))
  })

  test.each([
    [0, "cat"],
    [0.25, "chick"],
    [0.45, "red panda"],
    [0.65, "dragon"],
    [0.99, "dog"],
  ])("a roll of %s picks the %s", (roll, name) => {
    const { writes, controller } = harness(() => roll)
    controller.update(busy)
    const animal = TUI_PROGRAM_CHROME_ANIMATIONS.find((animation) => animation.name === name)!
    expect(shown(writes.at(-1)!)).toBe(animal.sprites[0]!.frames[0])
    controller.dispose()
  })

  test("each busy period picks an animal at random and keeps it until idle", () => {
    const rolls = [0.25, 0.1]
    const { writes, controller } = harness(() => rolls.shift() ?? 0)
    controller.update(busy)
    expect(shown(writes.at(-1)!)).toBe(CHICK.sprites[0]!.frames[0])
    // A status change mid-run keeps the chick.
    controller.update({ ...busy, statusText: "Retrying" })
    expect(shown(writes.at(-1)!)).toBe(CHICK.sprites[0]!.frames[0])
    vi.advanceTimersByTime(CHICK.frameMs * 4)
    expect(shown(writes.at(-1)!)).toBe(CHICK.sprites[4]!.frames[0])
    // Idle, then the next run rolls again.
    controller.update({ ...busy, busy: false })
    controller.update(busy)
    expect(shown(writes.at(-1)!)).toBe(CAT.sprites[0]!.frames[0])
    controller.dispose()
  })

  test("each tick advances one cat frame and the cycle wraps", () => {
    const { writes, controller } = harness()
    controller.update(busy)
    for (let i = 1; i <= CAT.sprites.length; i++) {
      vi.advanceTimersByTime(TUI_PROGRAM_CHROME_FRAME_MS)
      expect(shown(writes.at(-1)!)).toBe(frame(i))
    }
    // Ticks send only the sprite; status and progress persist in the document.
    expect(parse(writes.at(-1)!)).toMatchObject({ status: { text: "Working" }, progress: "indeterminate", mark: 0 })
    controller.dispose()
  })

  test("the animation preference switches to frame zero and cancels playback", () => {
    const { writes, controller } = harness()
    controller.update(busy)
    vi.advanceTimersByTime(TUI_PROGRAM_CHROME_FRAME_MS)
    controller.update({ ...busy, animations: false })
    expect(parse(writes.at(-1)!).mark).toBe(0)
    const count = writes.length
    vi.advanceTimersByTime(2000)
    expect(writes).toHaveLength(count)
    controller.dispose()
  })

  test("status updates keep the current pose and the next animation deadline", () => {
    const { writes, controller } = harness()
    controller.update(busy)
    vi.advanceTimersByTime(TUI_PROGRAM_CHROME_FRAME_MS * 4 + 50)
    expect(shown(writes.at(-1)!)).toBe(frame(4))
    controller.update({ ...busy, statusText: "Retrying" })
    expect(parse(writes.at(-1)!).status.text).toBe("Retrying")
    expect(shown(writes.at(-1)!)).toBe(frame(4))
    vi.advanceTimersByTime(TUI_PROGRAM_CHROME_FRAME_MS - 50)
    expect(shown(writes.at(-1)!)).toBe(frame(5))
    controller.dispose()
  })

  test.each(["rejected", "thrown"])("a %s status write stops playback and permits a retry", (failure) => {
    let failing = false
    const write = vi.fn(() => {
      if (failing && failure === "thrown") throw new Error("terminal closed")
      return !failing
    })
    const controller = createTuiProgramChrome({ supported: true, write, onError: vi.fn(), random: () => 0 })
    controller.update(busy)
    vi.advanceTimersByTime(TUI_PROGRAM_CHROME_FRAME_MS * 4)
    failing = true
    const retry = { ...busy, statusText: "Retrying" }
    if (failure === "thrown") expect(() => controller.update(retry)).toThrow("terminal closed")
    else expect(controller.update(retry)).toBe(false)
    const count = write.mock.calls.length
    vi.advanceTimersByTime(1000)
    expect(write).toHaveBeenCalledTimes(count)
    failing = false
    expect(controller.update(retry)).toBe(true)
    vi.advanceTimersByTime(TUI_PROGRAM_CHROME_FRAME_MS)
    expect(write).toHaveBeenCalledTimes(count + 2)
    controller.dispose()
  })

  test.each([{ busy: false }, { enabled: false }])(
    "idle and title opt-out clear chrome and stop timers: %j",
    (change) => {
      const { writes, controller } = harness()
      controller.update(busy)
      controller.update({ ...busy, ...change })
      expect(writes.at(-1)).toBe(CHROME_CLEAR_SEQUENCE)
      const count = writes.length
      vi.advanceTimersByTime(2000)
      expect(writes).toHaveLength(count)
      controller.dispose()
    },
  )

  test("a synchronous failed first tick cancels the returned scheduler handle", () => {
    const cancel = vi.fn()
    let writes = 0
    const controller = createTuiProgramChrome({
      supported: true,
      random: () => 0,
      write: () => ++writes !== 2,
      schedule: (tick) => {
        tick()
        return cancel
      },
      onError: vi.fn(),
    })
    controller.update(busy)
    expect(cancel).toHaveBeenCalledOnce()
    controller.dispose()
  })

  test("cancelled callbacks cannot advance a replacement animation", () => {
    const ticks: (() => void)[] = []
    const writes: string[] = []
    const controller = createTuiProgramChrome({
      supported: true,
      random: () => 0,
      write: (sequence) => {
        writes.push(sequence)
        return true
      },
      schedule: (tick) => {
        ticks.push(tick)
        return () => {}
      },
      onError: vi.fn(),
    })
    controller.update(busy)
    controller.update({ ...busy, busy: false })
    controller.update(busy)
    const count = writes.length
    ticks[0]!()
    expect(writes).toHaveLength(count)
    ticks[1]!()
    expect(writes).toHaveLength(count + 1)
    controller.dispose()
  })

  test("failed animation writes permit an identical subsequent update to retry", () => {
    let failed = false
    const writes: string[] = []
    const controller = createTuiProgramChrome({
      supported: true,
      random: () => 0,
      onError: vi.fn(),
      write: (sequence) => {
        if (failed) return false
        writes.push(sequence)
        return true
      },
    })
    controller.update(busy)
    failed = true
    vi.advanceTimersByTime(TUI_PROGRAM_CHROME_FRAME_MS)
    failed = false
    expect(controller.update(busy)).toBe(true)
    // Frame 4 differs from frame 0, so it proves playback restarted and advanced.
    vi.advanceTimersByTime(TUI_PROGRAM_CHROME_FRAME_MS * 4)
    expect(frame(4)).not.toBe(frame(0))
    expect(shown(writes.at(-1)!)).toBe(frame(4))
    controller.dispose()
  })

  test("unsupported terminals, non-TTYs, SSH and multiplexers never receive chrome", () => {
    const write = vi.fn(() => true)
    for (const entry of [
      { env, isTTY: false },
      { env: { TERM_PROGRAM: "ghostty" }, isTTY: true },
      { env: { ...env, SSH_TTY: "remote" }, isTTY: true },
      { env: { ...env, TMUX: "outer" }, isTTY: true },
      { env: { TERM_PROGRAM: "vscode", WT_SESSION: "outer" }, isTTY: true },
    ]) {
      expect(supportsTuiProgramChrome(entry.env, entry.isTTY)).toBe(false)
      updateTuiProgramChrome(busy, { ...entry, owner: write, write, onError: vi.fn() })
    }
    vi.advanceTimersByTime(2000)
    expect(write).not.toHaveBeenCalled()
  })

  test("renderer writes and timer ticks use the existing serialized native queue", () => {
    const writes: string[] = []
    const target = {
      threaded: true,
      write: (sequence: string) => {
        writes.push(sequence)
      },
    }
    const original = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
    registerTuiSequenceTarget(target)
    // The shared controller rolls with Math.random; pin it to the cat.
    vi.spyOn(Math, "random").mockReturnValue(0)
    try {
      setTuiProgramChrome(busy, profile, process.stdout, env)
      vi.advanceTimersByTime(TUI_PROGRAM_CHROME_FRAME_MS)
      expect(writes).toHaveLength(2)
      expect(shown(writes.at(-1)!)).toBe(frame(1))
      disposeTuiProgramChrome()
      expect(writes.at(-1)).toBe(CHROME_CLEAR_SEQUENCE)
      const count = writes.length
      vi.advanceTimersByTime(2000)
      expect(writes).toHaveLength(count)
    } finally {
      unregisterTuiSequenceTarget(target)
      vi.restoreAllMocks()
      if (original) Object.defineProperty(process.stdout, "isTTY", original)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
    }
  })

  test("renderer profile opt-out prevents program chrome", () => {
    const write = vi.fn(() => true)
    const disabled = resolveTuiRenderProfile({ advancedTerminal: true, terminalTitleDisabled: true })
    setTuiProgramChrome(busy, disabled, { isTTY: true, write }, env)
    expect(write).not.toHaveBeenCalled()
  })

  test("renderer teardown clears chrome before destroying the renderer", async () => {
    const calls: string[] = []
    const stream = {
      isTTY: true,
      write: (sequence: string) => {
        calls.push(sequence)
        return true
      },
    }
    setTuiProgramChrome(busy, profile, stream, env)
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string, callback?: () => void) => {
      callback?.()
      return true
    }) as typeof process.stdout.write)
    try {
      await destroyTuiRenderer(
        {
          destroy: () => {
            calls.push("destroy")
          },
        },
        { ...profile, allowTerminalTitle: false },
      )
    } finally {
      stdout.mockRestore()
    }
    expect(calls).toContain(CHROME_CLEAR_SEQUENCE)
    expect(calls.indexOf(CHROME_CLEAR_SEQUENCE)).toBeLessThan(calls.indexOf("destroy"))
    const count = calls.length
    vi.advanceTimersByTime(2000)
    expect(calls).toHaveLength(count)
  })

  test("crash reset stops active playback and includes a direct OSC clear for native AkiTTY", () => {
    vi.stubEnv("TERM_PROGRAM", "Akitty")
    vi.stubEnv("TERM", "xterm-256color")
    for (const key of [
      "SSH_CONNECTION",
      "SSH_CLIENT",
      "SSH_TTY",
      "MOSH_CONNECTION",
      "TMUX",
      "TMUX_PANE",
      "STY",
      "ZELLIJ",
    ])
      vi.stubEnv(key, "")
    const writes: string[] = []
    const stream = {
      isTTY: true,
      write: (sequence: string) => {
        writes.push(sequence)
        return true
      },
    }
    setTuiProgramChrome(busy, profile, stream, env)
    resetTuiTerminalState({ stdout: stream, stdin: { isTTY: false }, screenMode: "alternate-screen" })
    expect(writes.at(-1)).toContain(CHROME_CLEAR_SEQUENCE)
    expect(createTuiTerminalCrashResetSequence({ programChrome: true })).toContain(CHROME_CLEAR_SEQUENCE)
    const count = writes.length
    vi.advanceTimersByTime(2000)
    expect(writes).toHaveLength(count)
  })
})
