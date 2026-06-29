import { describe, expect, test } from "vitest"

import { decodeMermaidDataUrl, loadMermaidDataUrlSource } from "./toolOutputDialogMermaidSource"

describe("Mermaid data URL source loading", () => {
  test("decodes percent-encoded data URLs", () => {
    expect(decodeMermaidDataUrl("data:text/plain,graph%20TD%3BA--%3EB")).toBe("graph TD;A-->B")
  })

  test("decodes base64 data URLs", () => {
    expect(decodeMermaidDataUrl("data:text/plain;base64,Z3JhcGggVEQ7QS0tPkI=")).toBe("graph TD;A-->B")
  })

  test("turns malformed data URL payloads into rejected source loads", async () => {
    let sourcePromise: Promise<string> | null = null

    expect(() => {
      sourcePromise = loadMermaidDataUrlSource("data:text/plain,%E0%A4%A")
    }).not.toThrow()

    await expect(sourcePromise).rejects.toThrow("Malformed data URL")
  })
})
