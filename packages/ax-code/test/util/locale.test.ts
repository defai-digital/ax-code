import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

describe("Locale.duration", () => {
  test("renders milliseconds below 1s", () => {
    expect(Locale.duration(0)).toBe("0ms")
    expect(Locale.duration(500)).toBe("500ms")
    expect(Locale.duration(999)).toBe("999ms")
  })

  test("renders seconds below 1m", () => {
    expect(Locale.duration(1000)).toBe("1.0s")
    expect(Locale.duration(1500)).toBe("1.5s")
    expect(Locale.duration(59_999)).toBe("60.0s")
  })

  test("renders minutes below 1h", () => {
    expect(Locale.duration(60_000)).toBe("1m 0s")
    expect(Locale.duration(125_000)).toBe("2m 5s")
  })

  test("renders hours below 1d", () => {
    expect(Locale.duration(3_600_000)).toBe("1h 0m")
    expect(Locale.duration(3_780_000)).toBe("1h 3m")
    expect(Locale.duration(86_399_999)).toBe("23h 59m")
  })

  test("renders days and hours at >= 1d (regression: days/hours were swapped)", () => {
    expect(Locale.duration(86_400_000)).toBe("1d 0h")
    expect(Locale.duration(90_000_000)).toBe("1d 1h") // 25h
    expect(Locale.duration(97_200_000)).toBe("1d 3h") // 27h
    expect(Locale.duration(172_800_000)).toBe("2d 0h") // 48h
    expect(Locale.duration(180_000_000)).toBe("2d 2h") // 50h
  })
})

describe("Locale.number", () => {
  test("formats large numbers with K/M suffixes", () => {
    expect(Locale.number(1)).toBe("1")
    expect(Locale.number(999)).toBe("999")
    expect(Locale.number(1000)).toBe("1.0K")
    expect(Locale.number(1500)).toBe("1.5K")
    expect(Locale.number(1_000_000)).toBe("1.0M")
    expect(Locale.number(2_500_000)).toBe("2.5M")
  })
})

describe("Locale.pluralize", () => {
  test("picks singular vs plural and substitutes count", () => {
    expect(Locale.pluralize(1, "{} step remains", "{} steps remain")).toBe("1 step remains")
    expect(Locale.pluralize(3, "{} step remains", "{} steps remain")).toBe("3 steps remain")
    expect(Locale.pluralize(0, "{} step remains", "{} steps remain")).toBe("0 steps remain")
  })
})

describe("Locale.truncate", () => {
  test("returns the string unchanged when within the limit", () => {
    expect(Locale.truncate("abc", 5)).toBe("abc")
    expect(Locale.truncate("abc", 3)).toBe("abc")
  })

  test("truncates with ellipsis when over the limit", () => {
    expect(Locale.truncate("abcdef", 4)).toBe("abc…")
  })
})

describe("Locale.truncateMiddle", () => {
  test("returns the string unchanged when within the limit", () => {
    expect(Locale.truncateMiddle("hello", 35)).toBe("hello")
    expect(Locale.truncateMiddle("hello", 5)).toBe("hello")
  })

  test("truncates keeping start and end with ellipsis in the middle", () => {
    const out = Locale.truncateMiddle("abcdefghij", 7)
    // maxLength 7, ellipsis 1 char → keepStart = ceil(6/2)=3, keepEnd = floor(6/2)=3
    expect(out).toBe("abc…hij")
    expect(out.length).toBe(7)
  })
})

describe("Locale.titlecase", () => {
  test("capitalizes the first letter of each word", () => {
    expect(Locale.titlecase("hello world")).toBe("Hello World")
    expect(Locale.titlecase("HELLO")).toBe("HELLO")
    expect(Locale.titlecase("")).toBe("")
  })
})
