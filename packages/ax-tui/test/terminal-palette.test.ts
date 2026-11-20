import { EventEmitter } from "node:events"
import { expect, test } from "vitest"
import { TerminalPalette } from "../src/lib/terminal-palette.js"
import { ManualClock } from "../src/testing/manual-clock.js"

function createDetector() {
  const stdin = Object.assign(new EventEmitter(), { isTTY: true }) as unknown as NodeJS.ReadStream
  const stdout = { isTTY: true, write: () => true } as unknown as NodeJS.WriteStream
  const clock = new ManualClock()
  const detector = new TerminalPalette({ stdin, stdout, clock })
  return { detector, stdin, clock }
}

test("unrelated stdin traffic does not keep the palette query alive past the idle timeout", async () => {
  const { detector, stdin, clock } = createDetector()
  try {
    let resolved = false
    let results: Map<number, string | null> | undefined
    void detector["queryPalette"]([0], 1200, 300).then((value) => {
      resolved = true
      results = value
    })

    // Keystrokes and other non-OSC input must not reset the silence timer:
    // 5 chunks 200ms apart span 1000ms, well past the 300ms idle timeout.
    for (let i = 0; i < 5; i++) {
      clock.advance(200)
      stdin.emit("data", Buffer.from("x"))
    }
    await new Promise((resolve) => setImmediate(resolve))

    expect(resolved).toBe(true)
    expect(results?.get(0)).toBeNull()
  } finally {
    detector.cleanup()
  }
})

test("OSC 4 replies in both hex and rgb formats are collected", async () => {
  const { detector, stdin } = createDetector()
  try {
    const pending = detector["queryPalette"]([0, 1], 1200, 300)
    stdin.emit("data", Buffer.from("\x1b]4;0;#ff0000\x07\x1b]4;1;rgb:00/ff/00\x07"))
    const results = await pending

    expect(results.get(0)).toBe("#ff0000")
    expect(results.get(1)).toBe("#00ff00")
  } finally {
    detector.cleanup()
  }
})

test("a matching OSC 4 reply resets the idle timer for the remaining indices", async () => {
  const { detector, stdin, clock } = createDetector()
  try {
    let resolved = false
    let results: Map<number, string | null> | undefined
    void detector["queryPalette"]([0, 1], 1200, 300).then((value) => {
      resolved = true
      results = value
    })

    clock.advance(250)
    stdin.emit("data", Buffer.from("\x1b]4;0;#ff0000\x07"))
    await new Promise((resolve) => setImmediate(resolve))
    expect(resolved).toBe(false)

    // The reply at t=250 restarted the 300ms idle window (now due at t=550).
    clock.advance(250)
    await new Promise((resolve) => setImmediate(resolve))
    expect(resolved).toBe(false)

    clock.advance(50)
    await new Promise((resolve) => setImmediate(resolve))
    expect(resolved).toBe(true)
    expect(results?.get(0)).toBe("#ff0000")
    expect(results?.get(1)).toBeNull()
  } finally {
    detector.cleanup()
  }
})

test("consumed OSC 4 replies cannot re-match on later unrelated chunks", async () => {
  const { detector, stdin, clock } = createDetector()
  try {
    let resolved = false
    let results: Map<number, string | null> | undefined
    void detector["queryPalette"]([0, 1], 1200, 300).then((value) => {
      resolved = true
      results = value
    })

    clock.advance(100)
    stdin.emit("data", Buffer.from("\x1b]4;0;#ff0000\x07"))
    await new Promise((resolve) => setImmediate(resolve))
    expect(resolved).toBe(false)

    // Keystrokes inside the idle window must not re-match the consumed reply
    // and stretch the query to the hard timeout (t=1200). Idle is due at t=400.
    for (let i = 0; i < 5; i++) {
      clock.advance(200)
      stdin.emit("data", Buffer.from("x"))
      await new Promise((resolve) => setImmediate(resolve))
    }

    expect(resolved).toBe(true)
    expect(results?.get(0)).toBe("#ff0000")
    expect(results?.get(1)).toBeNull()
  } finally {
    detector.cleanup()
  }
})

test("consumed special-color replies cannot re-match on later unrelated chunks", async () => {
  const { detector, stdin, clock } = createDetector()
  try {
    let resolved = false
    void detector["querySpecialColors"](1200, 300).then(() => {
      resolved = true
    })

    clock.advance(100)
    stdin.emit("data", Buffer.from("\x1b]10;#ffffff\x07"))
    await new Promise((resolve) => setImmediate(resolve))
    expect(resolved).toBe(false)

    for (let i = 0; i < 5; i++) {
      clock.advance(200)
      stdin.emit("data", Buffer.from("x"))
      await new Promise((resolve) => setImmediate(resolve))
    }

    expect(resolved).toBe(true)
  } finally {
    detector.cleanup()
  }
})

test("parallel OSC 4 replies keep the special-color query alive past its idle timeout", async () => {
  const { detector, stdin, clock } = createDetector()
  try {
    let paletteResolved = false
    let specialResolved = false
    let specialResults: Record<number, string | null> | undefined
    void detector["queryPalette"]([0, 1], 5000, 300).then(() => {
      paletteResolved = true
    })
    void detector["querySpecialColors"](5000, 300).then((value) => {
      specialResolved = true
      specialResults = value
    })

    clock.advance(250)
    stdin.emit("data", Buffer.from("\x1b]4;0;#ff0000\x07\x1b]4;1;#00ff00\x07"))
    await new Promise((resolve) => setImmediate(resolve))
    expect(paletteResolved).toBe(true)
    expect(specialResolved).toBe(false)

    // The OSC 4 traffic at t=250 is sibling activity for the special-color
    // session: its idle window must restart instead of expiring at t=300.
    clock.advance(100)
    stdin.emit("data", Buffer.from("\x1b]10;#ffffff\x07"))
    await new Promise((resolve) => setImmediate(resolve))
    expect(specialResolved).toBe(false)

    clock.advance(300)
    await new Promise((resolve) => setImmediate(resolve))
    expect(specialResolved).toBe(true)
    expect(specialResults?.[10]).toBe("#ffffff")
    expect(specialResults?.[11]).toBeNull()
  } finally {
    detector.cleanup()
  }
})

test("parallel special-color replies keep the OSC 4 palette query alive past its idle timeout", async () => {
  const { detector, stdin, clock } = createDetector()
  try {
    let paletteResolved = false
    let paletteResults: Map<number, string | null> | undefined
    let specialResolved = false
    void detector["queryPalette"]([0, 1], 5000, 300).then((value) => {
      paletteResolved = true
      paletteResults = value
    })
    void detector["querySpecialColors"](5000, 300).then(() => {
      specialResolved = true
    })

    clock.advance(250)
    stdin.emit("data", Buffer.from("\x1b]10;#ffffff\x07"))
    await new Promise((resolve) => setImmediate(resolve))
    expect(specialResolved).toBe(false)
    expect(paletteResolved).toBe(false)

    // The OSC 10 traffic at t=250 must restart the palette session's idle
    // window; the OSC 4 reply at t=350 then restarts it again (due at t=650).
    clock.advance(100)
    stdin.emit("data", Buffer.from("\x1b]4;0;#ff0000\x07"))
    await new Promise((resolve) => setImmediate(resolve))
    expect(paletteResolved).toBe(false)

    clock.advance(250)
    await new Promise((resolve) => setImmediate(resolve))
    expect(paletteResolved).toBe(false)

    clock.advance(50)
    await new Promise((resolve) => setImmediate(resolve))
    expect(paletteResolved).toBe(true)
    expect(paletteResults?.get(0)).toBe("#ff0000")
    expect(paletteResults?.get(1)).toBeNull()
  } finally {
    detector.cleanup()
  }
})
