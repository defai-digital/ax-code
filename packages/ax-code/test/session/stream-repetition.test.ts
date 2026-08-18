import { describe, expect, test } from "vitest"
import { StreamRepetition } from "../../src/session/stream-repetition"

const fast = {
  minTotalChars: 100,
  checkIntervalChars: 1,
}

const phrase =
  "OK let me batch all the `data-i18n` attribute additions. I'll batch as many as I can per message this time."

describe("stream-repetition", () => {
  test("does not trigger before minTotalChars", () => {
    const guard = StreamRepetition.create({ ...fast, minTotalChars: 10_000 })
    const detection = guard.push(`${phrase}\n`.repeat(20))
    expect(detection).toBeUndefined()
  })

  test("does not trigger on normal varied output", () => {
    const guard = StreamRepetition.create(fast)
    let detection: StreamRepetition.Detection | undefined
    for (let i = 0; i < 50; i++) {
      detection = guard.push(`Step ${i}: reading file number ${i} to understand its structure.\n`)
    }
    expect(detection).toBeUndefined()
  })

  test("detects the same paragraph repeated with filler between (observed local-model loop)", () => {
    const guard = StreamRepetition.create(fast)
    let detection: StreamRepetition.Detection | undefined
    for (let i = 0; i < 10 && !detection; i++) {
      detection =
        guard.push(`${phrase}\n`) ??
        guard.push(`Actually I need to re-check the indentation of block ${i} first.\n`) ??
        guard.push(`<li><a href="#item-${i}">Item ${i}</a></li>\n`)
    }
    expect(detection).toBeDefined()
    expect(detection!.kind).toBe("segment")
    expect(detection!.count).toBeGreaterThan(StreamRepetition.MAX_SEGMENT_REPEATS)
  })

  test("detects back-to-back tail repetition in single-line streams", () => {
    const guard = StreamRepetition.create(fast)
    const unit = "the model is stuck saying this sentence over and over. "
    const detection = guard.push(unit.repeat(30))
    expect(detection).toBeDefined()
    expect(detection!.kind).toBe("tail")
    expect(detection!.count).toBeGreaterThanOrEqual(3)
  })

  test("two occurrences of the same paragraph do not trigger", () => {
    const guard = StreamRepetition.create(fast)
    let detection: StreamRepetition.Detection | undefined
    for (let i = 0; i < 2; i++) {
      detection =
        detection ??
        guard.push(`${phrase}\nSome genuinely different analysis for pass ${i}, with enough text to matter.\n`)
    }
    // pad so the window check runs over both occurrences
    detection = detection ?? guard.push("final thoughts that wrap the whole thing up nicely here.\n")
    expect(detection).toBeUndefined()
  })

  test("short lines repeated often do not trigger the segment check", () => {
    const guard = StreamRepetition.create(fast)
    let detection: StreamRepetition.Detection | undefined
    for (let i = 0; i < 30; i++) {
      detection = detection ?? guard.push("ok\n")
    }
    expect(detection).toBeUndefined()
  })

  test("throttling still catches a loop within a long stream", () => {
    const guard = StreamRepetition.create({ minTotalChars: 4096, checkIntervalChars: 512 })
    let detection: StreamRepetition.Detection | undefined
    for (let i = 0; i < 200 && !detection; i++) {
      detection = guard.push(`${phrase}\n`)
    }
    expect(detection).toBeDefined()
    expect(detection!.kind).toBe("segment")
  })

  test("reset clears accumulated state", () => {
    const guard = StreamRepetition.create(fast)
    guard.push(`${phrase}\n`.repeat(10))
    guard.reset()
    const detection = guard.push("a fresh start with no repetition anywhere in sight.\n")
    expect(detection).toBeUndefined()
  })
})
