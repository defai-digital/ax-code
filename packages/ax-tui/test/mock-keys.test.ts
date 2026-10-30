import { EventEmitter } from "node:events"
import { describe, expect, test, vi } from "vitest"
import { createMockKeys } from "../src/testing/mock-keys.js"
import type { CliRenderer } from "../src/core/renderer.js"

function createHarness(options?: Parameters<typeof createMockKeys>[1]) {
  const stdin = new EventEmitter()
  const emitted: Buffer[] = []
  stdin.on("data", (chunk: Buffer) => emitted.push(chunk))
  const renderer = { stdin } as unknown as CliRenderer
  return { keys: createMockKeys(renderer, options), emitted, stdin }
}

describe("createMockKeys", () => {
  test("typeText emits astral characters as whole code points", async () => {
    const { keys, emitted } = createHarness()

    await keys.typeText("a😀b")

    const text = Buffer.concat(emitted).toString("utf8")
    expect(text).toBe("a😀b")
    // The emoji must arrive as a single write, not two lone surrogates.
    expect(emitted.map((chunk) => chunk.toString("utf8"))).toContain("😀")
  })

  test("pasteBracketedText emits a body that looks like a key name verbatim", async () => {
    const { keys, emitted } = createHarness()

    await keys.pasteBracketedText("TAB")

    const text = Buffer.concat(emitted).toString("utf8")
    expect(text).toBe(`\x1b[200~TAB\x1b[201~`)
    expect(text).not.toContain("\t")
  })

  test("pressKey still resolves key names", () => {
    const { keys, emitted } = createHarness()

    keys.pressTab()

    expect(Buffer.concat(emitted).toString("utf8")).toBe("\t")
  })
})
