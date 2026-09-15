import { describe, expect, test } from "vitest"
import { StreamRepetition } from "../../src/session/stream-repetition"

const fast = {
  minTotalChars: 100,
  checkIntervalChars: 1,
}

const phrase =
  "OK let me batch all the `data-i18n` attribute additions. I'll batch as many as I can per message this time."

describe("stream-repetition", () => {
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

describe("truncateLoopedText", () => {
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
