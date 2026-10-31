import { describe, expect, test } from "vitest"
import { StreamRepetition } from "../../src/session/stream-repetition"

const fast = {
  minTotalChars: 100,
  checkIntervalChars: 1,
}

const phrase =
  "OK let me batch all the `data-i18n` attribute additions. I'll batch as many as I can per message this time."

describe("stream-repetition", () => {
  test("retains incomplete lines across chunk boundaries", () => {
    const options = { minTotalChars: 0, checkIntervalChars: 1, minSegmentChars: 3, maxSegmentRepeats: 2 }
    const whole = StreamRepetition.create(options)
    const split = StreamRepetition.create(options)
    const first = "a\nbc"
    const rest = "d\na\nbcd\nbcd\n"
    expect(split.push(first)).toBeUndefined()
    const expected = whole.push(first + rest)
    expect(expected?.unit).toBe("bcd")
    expect(split.push(rest)).toEqual(expected)
  })

  test("detects a loop before a large delta evicts it from the analysis window", () => {
    const loop = `${phrase}\n`.repeat(50)
    const suffix = Array.from(
      { length: 150 },
      (_, i) => `Unique ending ${i} with a different observation for item ${i}.\n`,
    ).join("")
    const output = loop + suffix
    const whole = StreamRepetition.create()
    const split = StreamRepetition.create()
    let detection: StreamRepetition.Detection | undefined
    for (let offset = 0; offset < output.length && !detection; offset += 37)
      detection = split.push(output.slice(offset, offset + 37))
    expect(detection).toBeDefined()
    expect(whole.push(output)).toEqual(detection)
  })

  test.each([1, 37, 512, 10_000])("allows shared setup in distinct fenced tests with %i-character deltas", (size) => {
    const guard = StreamRepetition.create()
    const output = Array.from({ length: 24 }, (_, i) =>
      [
        `Regression ${i} checks a separate search behavior and its expected result.`,
        "```ts",
        `test("search case ${i}", async () => {`,
        "  await using tmp = await tmpdir({ git: true })",
        `  const source = "unique source for case ${i}"`,
        `  const result = await search({ source, limit: ${i + 1}, directory: tmp.path })`,
        `  expect(result.matches).toHaveLength(${i})`,
        "})",
        "```",
        "",
      ].join("\n"),
    ).join("\n")
    expect(output.length).toBeGreaterThan(StreamRepetition.MIN_TOTAL_CHARS + StreamRepetition.CHECK_INTERVAL_CHARS)
    for (let offset = 0; offset < output.length; offset += size) {
      expect(guard.push(output.slice(offset, offset + size))).toBeUndefined()
    }
  })

  test("allows shared 4-space-indented setup lines in distinct Markdown examples", () => {
    const setup = '    $ ax-code run --sandbox read-only --title "Example" "summarize this change"'
    const examples = [
      "The first example explains how a read-only review is scoped to one prompt.",
      "The second example explains how the same command reports a different verdict.",
      "The third example applies the command to a longer operator request.",
      "The fourth example passes a different title while keeping the same shape.",
    ]
    const output =
      "Four legal Markdown examples share one indented setup line.\n\n" +
      examples.map((line, i) => `Example ${i + 1}: ${line}\n\n${setup}\n\n`).join("")
    for (const size of [output.length, 1, 37, 512]) {
      const guard = StreamRepetition.create(fast)
      for (let offset = 0; offset < output.length; offset += size) {
        expect(guard.push(output.slice(offset, offset + size))).toBeUndefined()
      }
    }
  })

  test("still detects back-to-back repetition in indented code as a tail loop", () => {
    const guard = StreamRepetition.create(fast)
    const unit = '    const value = await loadSomething("source.ts")\n'
    const detection = guard.push(unit.repeat(30))
    expect(detection?.kind).toBe("tail")
    expect(detection!.count).toBeGreaterThanOrEqual(StreamRepetition.MIN_TAIL_REPEATS)
  })

  test("keeps fence state when the opening delimiter leaves the sliding window", () => {
    const guard = StreamRepetition.create({ ...fast, windowChars: 600 })
    guard.push("~~~~typescript\n")
    for (let i = 0; i < 60; i++) {
      expect(guard.push(`const uniqueValue${i} = ${i}\n${phrase}\n`)).toBeUndefined()
    }
    // A shorter fence, or one with trailing content, cannot close the block.
    expect(guard.push("~~~\n~~~~ not a closing fence\n")).toBeUndefined()
    for (let i = 0; i < 6; i++) {
      expect(guard.push(`const otherValue${i} = ${i}\n${phrase}\n`)).toBeUndefined()
    }
    guard.push("~~~~~\n")
    let detection: StreamRepetition.Detection | undefined
    for (let i = 0; i < 10 && !detection; i++) {
      detection = guard.push(`${phrase}\nDifferent prose ${i}.\n`)
    }
    expect(detection?.kind).toBe("segment")
  })

  test("still detects consecutive output loops inside an unclosed code fence", () => {
    const guard = StreamRepetition.create()
    guard.push("```ts\n")
    let detection: StreamRepetition.Detection | undefined
    for (let i = 0; i < 200 && !detection; i++) {
      detection = guard.push("await using tmp = await tmpdir({ git: true })\n")
    }
    expect(detection?.kind).toBe("tail")
  })

  test.each([12, 20])("detects a repeated %i-line code block longer than the old 600-character tail cap", (lines) => {
    const guard = StreamRepetition.create()
    const unit = Array.from(
      { length: lines },
      (_, i) => `const value${i} = await readAndValidateSource("source-${i}.ts", { verify: true, cache: false })\n`,
    ).join("")
    expect(unit.length).toBeGreaterThan(600)
    guard.push("```ts\n")
    let detection: StreamRepetition.Detection | undefined
    for (let i = 0; i < 20 && !detection; i++) detection = guard.push(unit)
    expect(detection?.kind).toBe("tail")
  })

  test("detects an identical 2070-character fenced block repeated beyond the old raw window", () => {
    // 22 lines: opener (6 chars) + 20 x 103-char body lines + closer (4 chars).
    const body = Array.from(
      { length: 20 },
      (_, i) => `  const value${i} = await loadSource("file-${i}.ts", { verify: true })`.padEnd(102) + "\n",
    ).join("")
    const unit = "```ts\n" + body + "```\n"
    expect(unit.length).toBe(2070)
    // Longer than the old 6144/3 tail-unit cap, but within the raw tail window.
    expect(unit.length).toBeGreaterThan(StreamRepetition.WINDOW_CHARS / StreamRepetition.MIN_TAIL_REPEATS)

    const output = unit.repeat(20)

    const whole = StreamRepetition.create(fast)
    expect(whole.push(output)?.kind).toBe("tail")

    const split = StreamRepetition.create(fast)
    let detection: StreamRepetition.Detection | undefined
    for (let offset = 0; offset < output.length && !detection; offset += 37)
      detection = split.push(output.slice(offset, offset + 37))
    expect(detection?.kind).toBe("tail")
  })

  test("reset clears an unclosed fence before checking prose in a new step", () => {
    const guard = StreamRepetition.create(fast)
    guard.push("```ts\nconst unfinished = true\n")
    guard.reset()
    const output = Array.from({ length: 6 }, (_, i) => `${phrase}\nNew reasoning ${i}.\n`).join("")
    expect(guard.push(output)?.kind).toBe("segment")
  })

  test("does not count an incomplete prose line that shares a prefix with earlier lines", () => {
    const guard = StreamRepetition.create(fast)
    for (let i = 0; i < 3; i++) expect(guard.push(`${phrase}\nDifferent interlude ${i}.\n`)).toBeUndefined()
    expect(guard.push(phrase)).toBeUndefined()
    expect(guard.push(" This fourth statement adds a different conclusion.\n")).toBeUndefined()
  })

  test("detects identical complete code blocks separated by different prose", () => {
    const guard = StreamRepetition.create()
    const body = Array.from(
      { length: 10 },
      (_, i) => `const result${i} = await validateSource("source-${i}.ts", { check: true, output: "complete" })\n`,
    ).join("")
    let detection: StreamRepetition.Detection | undefined
    for (let i = 0; i < 12 && !detection; i++) {
      detection = guard.push(`Different explanation ${i}.\n\`\`\`${i % 2 ? "typescript" : "ts"}\n${body}\`\`\`\n`)
    }
    expect(detection?.kind).toBe("segment")
  })

  test("does not merge code blocks whose string literals contain different whitespace", () => {
    const guard = StreamRepetition.create(fast)
    for (let i = 1; i <= 10; i++) {
      expect(
        guard.push(
          `Example ${i}.\n\`\`\`ts\nconst expectedMessage = "a${" ".repeat(i)}different whitespace-sensitive value"\n\`\`\`\n`,
        ),
      ).toBeUndefined()
    }
  })

  test.each(["```js```", "```ts `invalid`"])("does not let invalid opener %s hide prose loops", (opener) => {
    const guard = StreamRepetition.create(fast)
    guard.push(opener + "\n")
    expect(
      guard.push(Array.from({ length: 6 }, (_, i) => `${phrase}\nDifferent interlude ${i}.\n`).join(""))?.kind,
    ).toBe("segment")
  })

  test("ages old prose out while streaming a large fenced block and a long code line", () => {
    const guard = StreamRepetition.create(fast)
    for (let i = 0; i < 3; i++) expect(guard.push(`${phrase}\nUnique reasoning ${i}.\n`)).toBeUndefined()
    expect(guard.push("```ts\n")).toBeUndefined()
    for (let i = 0; i < 1000; i++) expect(guard.push(`value${i} + `)).toBeUndefined()
    expect(guard.push("\n```\n")).toBeUndefined()
    expect(guard.push(`${phrase}\nA fresh occurrence after the code.\n`)).toBeUndefined()
  })

  test("allows CRLF code fences split across deltas", () => {
    const guard = StreamRepetition.create(fast)
    const output = Array.from(
      { length: 8 },
      (_, i) => `   ~~~~ts\r\n${phrase}\r\nunique(${i})\r\n   ~~~~~\r\nCase ${i} is complete.\r\n`,
    ).join("")
    for (const char of output) expect(guard.push(char)).toBeUndefined()
  })

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

  test("many unique long paragraphs do not trigger or grow without bound", () => {
    const guard = StreamRepetition.create(fast)
    let detection: StreamRepetition.Detection | undefined
    for (let i = 0; i < 300; i++) {
      detection = detection ?? guard.push(`Unique paragraph ${i} with enough characters to pass the segment floor.\n`)
    }
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

/**
 * Verbatim copy of `StreamRepetition.create` from before the lazy window
 * accumulation optimization: the raw tail window was rebuilt by copying
 * `(window + chunk).slice(-tailWindowChars)` on every chunk. Kept purely as
 * the reference the optimized implementation must match on every input.
 */
function createReferenceGuard(options: StreamRepetition.Options = {}) {
  const minTotalChars = options.minTotalChars ?? StreamRepetition.MIN_TOTAL_CHARS
  const windowChars = options.windowChars ?? StreamRepetition.WINDOW_CHARS
  const tailWindowChars = options.windowChars ?? StreamRepetition.TAIL_WINDOW_CHARS
  const checkIntervalChars = options.checkIntervalChars ?? StreamRepetition.CHECK_INTERVAL_CHARS
  const minSegmentChars = options.minSegmentChars ?? StreamRepetition.MIN_SEGMENT_CHARS
  const maxSegmentRepeats = options.maxSegmentRepeats ?? StreamRepetition.MAX_SEGMENT_REPEATS
  const minTailUnitChars = options.minTailUnitChars ?? StreamRepetition.MIN_TAIL_UNIT_CHARS
  const maxTailUnitChars = options.maxTailUnitChars ?? StreamRepetition.MAX_TAIL_UNIT_CHARS
  const minTailRepeats = options.minTailRepeats ?? StreamRepetition.MIN_TAIL_REPEATS
  const MAX_ANCHOR_OCCURRENCES = 64
  const MAX_SEGMENT_KEYS = 256

  const normalizeSegment = (raw: string): string => raw.trim().replace(/\s+/g, " ")
  type Segment = { start: number; text: string; kind: "prose" | "code" }

  const detectSegmentRepeat = (segments: Segment[], maxRepeats: number): StreamRepetition.Detection | undefined => {
    const counts = new Map<string, number>()
    for (const segment of segments) {
      const key = `${segment.kind}:${segment.text}`
      const count = (counts.get(key) ?? 0) + 1
      if (count > maxRepeats) {
        return { kind: "segment", unit: segment.text.slice(0, 200), count }
      }
      if (counts.size >= MAX_SEGMENT_KEYS && !counts.has(key)) continue
      counts.set(key, count)
    }
    return undefined
  }

  const detectTailRepeat = (
    window: string,
    minUnitChars: number,
    maxUnitChars: number,
    minRepeats: number,
  ): StreamRepetition.Detection | undefined => {
    const anchor = window.slice(-minUnitChars)
    if (anchor.length < minUnitChars) return undefined
    const anchorStart = window.length - minUnitChars
    let from = anchorStart - 1
    let scanned = 0
    while (scanned < MAX_ANCHOR_OCCURRENCES) {
      const p = window.lastIndexOf(anchor, from)
      if (p === -1) break
      scanned++
      from = p - 1
      const period = anchorStart - p
      if (period > maxUnitChars) break
      if (period < minUnitChars) continue
      const unit = window.slice(window.length - period)
      const runLength = period * minRepeats
      if (runLength > window.length) continue
      const tail = window.slice(window.length - runLength)
      if (tail === unit.repeat(minRepeats)) {
        let count = minRepeats
        while (window.length - (count + 1) * period >= 0) {
          const prev = window.slice(window.length - (count + 1) * period, window.length - count * period)
          if (prev !== unit) break
          count++
        }
        return { kind: "tail", unit: unit.slice(0, 200), count }
      }
    }
    return undefined
  }

  let total = 0
  let window = ""
  let sinceCheck = 0
  let segments: Segment[] = []
  let pendingLine = ""
  let lineLength = 0
  let lineStart = 0
  let fence: { marker: string; length: number; start: number; body: string; overflow: boolean } | undefined

  const pruneSegments = (end: number) => {
    while (segments.length && segments[0].start < end - windowChars) segments.shift()
  }
  const recordSegment = (raw: string, start: number, kind: Segment["kind"]) => {
    if (kind === "prose" && /^(?: {4}|\t)/.test(raw)) return
    const text = kind === "code" ? raw.trim() : normalizeSegment(raw)
    if (text.length >= minSegmentChars) segments.push({ start, text, kind })
  }

  const appendSegments = (delta: string) => {
    let offset = 0
    while (offset < delta.length) {
      const newline = delta.indexOf("\n", offset)
      const end = newline === -1 ? delta.length : newline
      const length = end - offset
      pendingLine += delta.slice(offset, offset + Math.min(length, windowChars - pendingLine.length))
      lineLength += length
      if (newline === -1) break

      const lineEnd = lineStart + lineLength + 1
      pruneSegments(lineEnd)
      const delimiter = lineLength <= windowChars ? /^ {0,3}(`{3,}|~{3,})(.*)\r?$/.exec(pendingLine) : null
      if (fence) {
        if (lineEnd - fence.start > windowChars) {
          fence.body = ""
          fence.overflow = true
        }
        if (
          delimiter &&
          delimiter[1][0] === fence.marker &&
          delimiter[1].length >= fence.length &&
          !delimiter[2].trim()
        ) {
          if (!fence.overflow) recordSegment(fence.body, fence.start, "code")
          fence = undefined
        } else if (!fence.overflow) {
          fence.body += pendingLine + "\n"
        }
      } else if (delimiter && (delimiter[1][0] !== "`" || !delimiter[2].includes("`"))) {
        fence = { marker: delimiter[1][0], length: delimiter[1].length, start: lineStart, body: "", overflow: false }
      } else if (lineLength <= windowChars) {
        recordSegment(pendingLine, lineStart, "prose")
      }
      pendingLine = ""
      lineLength = 0
      lineStart = lineEnd
      offset = newline + 1
    }
  }

  return {
    push(delta: string): StreamRepetition.Detection | undefined {
      for (let offset = 0; offset < delta.length; ) {
        const untilCheck = Math.max(1, minTotalChars - total, checkIntervalChars - sinceCheck)
        const chunk = delta.slice(offset, offset + untilCheck)
        offset += chunk.length
        total += chunk.length
        window = (window + chunk).slice(-tailWindowChars)
        appendSegments(chunk)
        pruneSegments(total)
        sinceCheck += chunk.length
        if (total < minTotalChars || sinceCheck < checkIntervalChars) continue
        sinceCheck = 0
        const detection =
          detectSegmentRepeat(segments, maxSegmentRepeats) ??
          detectTailRepeat(window, minTailUnitChars, maxTailUnitChars, minTailRepeats)
        if (detection) return detection
      }
      return undefined
    },
    reset() {
      total = 0
      window = ""
      sinceCheck = 0
      segments = []
      pendingLine = ""
      lineLength = 0
      lineStart = 0
      fence = undefined
    },
  }
}

describe("stream-repetition equivalence with the eager-window reference", () => {
  /** Deterministic PRNG so randomized cases never flake. */
  const mulberry32 = (seed: number) => {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const assertEquivalent = (
    options: StreamRepetition.Options | undefined,
    deltas: string[],
    resetAfter: number[] = [],
  ) => {
    const guard = StreamRepetition.create(options)
    const reference = createReferenceGuard(options)
    const resets = new Set(resetAfter)
    deltas.forEach((delta, index) => {
      expect(guard.push(delta)).toEqual(reference.push(delta))
      if (resets.has(index)) {
        guard.reset()
        reference.reset()
      }
    })
  }

  const splitInto = (text: string, size: number): string[] => {
    const deltas: string[] = []
    for (let offset = 0; offset < text.length; offset += size) deltas.push(text.slice(offset, offset + size))
    return deltas
  }

  const buildRandomStream = (rng: () => number, targetLength: number): string => {
    const parts: string[] = []
    let length = 0
    let i = 0
    while (length < targetLength) {
      const pick = rng()
      i++
      if (pick < 0.25) parts.push(`${phrase}\n`)
      else if (pick < 0.4)
        parts.push(`Unique analysis ${i} covers a genuinely different aspect with enough characters.\n`)
      else if (pick < 0.55)
        parts.push(
          "```ts\n" +
            `const value${i % 5} = await loadSource("file-${i % 5}.ts", { verify: true })\n`.repeat(2) +
            "```\n",
        )
      else if (pick < 0.65) parts.push(`    $ run --case ${i} --verbose\n`)
      else if (pick < 0.72) parts.push(`interlude ${i}\r\n`)
      else if (pick < 0.84) parts.push("the model is stuck saying this sentence over and over. ")
      else if (pick < 0.94) parts.push(`漢字混合 ${i} のテキスト with 😀 emoji\n`)
      else parts.push(`lorem ${i} ` + "x".repeat(40) + " tail-anchor-constant-padding!!\n")
      length += parts[parts.length - 1].length
    }
    return parts.join("")
  }

  const randomSizes = (rng: () => number, count: number): number[] =>
    Array.from({ length: count }, () => {
      const pick = rng()
      if (pick < 0.35) return 1
      if (pick < 0.5) return 2 + Math.floor(rng() * 6)
      if (pick < 0.7) return 37
      if (pick < 0.85) return 512
      if (pick < 0.95) return 1500
      return 5000
    })

  test("matches on 1-char deltas over loops, fences, and unique lines", () => {
    const output =
      Array.from({ length: 60 }, (_, i) => `Unique reasoning ${i} with enough characters to matter.\n`).join("") +
      "```ts\n" +
      `const shared = await loadSource("source.ts")\n`.repeat(10) +
      "```\n" +
      `${phrase}\n`.repeat(200)
    // Defaults throttle checks to every 512 chars; fast options check on
    // every character — both must agree with the reference at every step.
    assertEquivalent(undefined, splitInto(output, 1))
    assertEquivalent({ minTotalChars: 100, checkIntervalChars: 1 }, splitInto(output.slice(0, 6000), 1))
  })

  test("matches on a single huge delta well past the window", () => {
    const unique = Array.from(
      { length: 1200 },
      (_, i) => `Line ${i} walks a different path through the analysis with padding to spare.\n`,
    ).join("")
    const output = unique + `${phrase}\n`.repeat(400) + unique.slice(0, 3000)
    expect(output.length).toBeGreaterThan(StreamRepetition.TAIL_WINDOW_CHARS * 2)
    assertEquivalent(undefined, [output])
  })

  test("matches at tail-unit period boundaries", () => {
    // 4096 = MAX_TAIL_UNIT_CHARS at the default tail window; 200 = the same
    // floor for a 600-char window (3 repeats must fit). ±1 straddles both.
    const cases = [
      [{ minTotalChars: 100, checkIntervalChars: 1 }, 4096],
      [{ minTotalChars: 100, checkIntervalChars: 1, windowChars: 600 }, 200],
    ] as const
    for (const [options, boundary] of cases) {
      for (const delta of [-1, 0, 1]) {
        const unit = "u".repeat(boundary + delta - 1) + "\n"
        assertEquivalent(options, splitInto(unit.repeat(8), 37))
      }
    }
  })

  test("matches without newlines in single-line tail loops", () => {
    for (const unitChars of [29, 30, 31, 200, 201]) {
      const output = "f".repeat(unitChars).repeat(30)
      assertEquivalent({ minTotalChars: 100, checkIntervalChars: 1, windowChars: 600 }, splitInto(output, 7))
    }
  })

  test("matches when the anchor scan budget is exhausted", () => {
    const tail = "tail-anchor-of-thirty-plus-chars!!!\n"
    const output = Array.from(
      { length: 300 },
      (_, i) => `${String(i).padStart(6, "0")} unique-prefix-${i} ${tail}`,
    ).join("")
    assertEquivalent({ minTotalChars: 100, checkIntervalChars: 1 }, splitInto(output, 97))
  })

  test("matches past the segment-key cap", () => {
    const unique = Array.from(
      { length: 400 },
      (_, i) => `Paragraph ${i} is long enough and completely unique in every way.\n`,
    ).join("")
    const output = unique + `${phrase}\n`.repeat(8)
    assertEquivalent({ minTotalChars: 100, checkIntervalChars: 1 }, splitInto(output, 211))
  })

  test.each([1, 7, 42, 1337, 65535])("matches on randomized stream and delta sizes (seed %i)", (seed) => {
    const rng = mulberry32(seed)
    const output = buildRandomStream(rng, 16_000)
    assertEquivalent(undefined, splitInto(output, 1))
    assertEquivalent(undefined, splitInto(output, 512))
    assertEquivalent(undefined, splitInto(output, 10_000))
    {
      const sizes = randomSizes(rng, 5_000)
      let offset = 0
      const deltas: string[] = []
      for (const size of sizes) {
        if (offset >= output.length) break
        deltas.push(output.slice(offset, offset + size))
        offset += size
      }
      assertEquivalent(undefined, deltas)
      assertEquivalent({ minTotalChars: 100, checkIntervalChars: 1, windowChars: 600 }, deltas.slice(0, 40))
    }
  })

  test("matches across reset boundaries", () => {
    const first = `${phrase}\n`.repeat(30)
    const second =
      Array.from({ length: 30 }, (_, i) => `Fresh line ${i} after the reset.\n`).join("") + `${phrase}\n`.repeat(10)
    const deltas = [...splitInto(first, 53), ...splitInto(second, 53)]
    assertEquivalent({ minTotalChars: 100, checkIntervalChars: 1 }, deltas, [splitInto(first, 53).length - 1])
  })
})

describe("truncateLoopedText", () => {
  test("keeps the head on a surrogate-safe boundary", () => {
    const out = StreamRepetition.truncateLoopedText("a".repeat(1999) + "😀" + "tail".repeat(10), 2000)
    expect(out).toStartWith("a".repeat(1999) + "\n\n[")
  })

  test("keeps short text untouched", () => {
    expect(StreamRepetition.truncateLoopedText("short plan text")).toBe("short plan text")
  })

  test("truncates long looped text to the head with an omission marker", () => {
    const looped = `${phrase}\n`.repeat(100)
    const result = StreamRepetition.truncateLoopedText(looped)

    expect(result.length).toBeLessThan(looped.length)
    expect(result.startsWith(looped.slice(0, 200))).toBe(true)
    expect(result).toContain(
      `${looped.length - StreamRepetition.TRUNCATED_LOOP_HEAD_CHARS} characters omitted: repetitive output removed by the output-loop guard`,
    )
  })

  test("respects a custom head limit", () => {
    const result = StreamRepetition.truncateLoopedText("x".repeat(1000), 100)
    expect(result.startsWith("x".repeat(100))).toBe(true)
    expect(result).toContain("900 characters omitted")
  })
})
