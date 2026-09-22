import { afterEach, describe, expect, test, vi } from "vitest"
import { UI } from "../../src/cli/ui"

const ESC = "\x1b"

const originalIsTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY")

function captureStderr(): () => string {
  let out = ""
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    out += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString()
    return true
  })
  return () => out
}

function stubIsTTY(value: boolean) {
  Object.defineProperty(process.stderr, "isTTY", { value, configurable: true, writable: true })
}

afterEach(() => {
  delete process.env.NO_COLOR
  vi.restoreAllMocks()
  if (originalIsTTY) Object.defineProperty(process.stderr, "isTTY", originalIsTTY)
  else delete (process.stderr as unknown as Record<string, unknown>).isTTY
})

describe("UI color hygiene", () => {
  test("println writes no escape bytes when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1"
    const read = captureStderr()
    UI.println("x")
    const out = read()
    expect(out).not.toContain(ESC)
    expect(out).toBe("x\n")
  })

  test("error writes Error: boom plus newline with no escape bytes when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1"
    const read = captureStderr()
    UI.error("boom")
    const out = read()
    expect(out).not.toContain(ESC)
    expect(out).toBe("Error: boom\n")
  })

  test("println writes no escape bytes when stderr is not a TTY", () => {
    stubIsTTY(false)
    const read = captureStderr()
    UI.println("x")
    const out = read()
    expect(out).not.toContain(ESC)
    expect(out).toBe("x\n")
  })

  test("styled error output still contains escape bytes with a TTY and NO_COLOR unset", () => {
    stubIsTTY(true)
    const read = captureStderr()
    UI.error("boom")
    const out = read()
    expect(out).toContain(ESC)
    // ANSI codes interleave the prefix and message, so assert the pieces
    // separately rather than the joined "Error: boom" substring.
    expect(out).toContain("Error:")
    expect(out).toContain("boom")
  })

  test("Style values resolve to the empty string when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1"
    expect(UI.Style.TEXT_NORMAL).toBe("")
    expect(UI.Style.TEXT_DANGER_BOLD).toBe("")
  })

  test("Style values resolve to the empty string when stderr is not a TTY", () => {
    stubIsTTY(false)
    expect(UI.Style.TEXT_HIGHLIGHT).toBe("")
    expect(UI.Style.TEXT_NORMAL).toBe("")
  })

  test("Style values keep their escape sequences with a TTY and NO_COLOR unset", () => {
    stubIsTTY(true)
    expect(UI.Style.TEXT_NORMAL).toBe("\x1b[0m")
    expect(UI.Style.TEXT_DANGER_BOLD).toBe("\x1b[91m\x1b[1m")
  })
})
