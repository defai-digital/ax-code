import { test, expect, describe } from "bun:test"
import { existsSync } from "node:fs"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { materializeCliAttachments } from "../../../src/provider/cli/attachments"

describe("materializeCliAttachments", () => {
  test("returns no refs and a no-op cleanup when there are no file parts", async () => {
    const prompt: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "hi" }] }]
    const result = await materializeCliAttachments(prompt)
    expect(result.refs).toEqual([])
    await result.cleanup() // must not throw
  })

  test("writes Uint8Array image data to a temp file and cleans it up", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "file", data: bytes, mediaType: "image/png" } as any] },
    ]
    const result = await materializeCliAttachments(prompt)
    expect(result.refs).toHaveLength(1)
    const ref = result.refs[0]!
    expect(ref.path).toBeDefined()
    expect(ref.path!.endsWith(".png")).toBe(true)
    expect(ref.mediaType).toBe("image/png")
    expect(existsSync(ref.path!)).toBe(true)

    await result.cleanup()
    expect(existsSync(ref.path!)).toBe(false)
  })

  test("decodes a base64 data URL to a temp file", async () => {
    const dataUrl = "data:image/jpeg;base64," + Buffer.from("jpeg-bytes").toString("base64")
    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "file", data: dataUrl, mediaType: "image/jpeg" } as any] },
    ]
    const result = await materializeCliAttachments(prompt)
    try {
      expect(result.refs).toHaveLength(1)
      expect(result.refs[0]!.path!.endsWith(".jpg")).toBe(true)
      expect(existsSync(result.refs[0]!.path!)).toBe(true)
    } finally {
      await result.cleanup()
    }
  })

  test("keeps remote URLs as references without writing a temp file", async () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "user",
        content: [{ type: "file", data: "https://example.com/cat.png", mediaType: "image/png" } as any],
      },
    ]
    const result = await materializeCliAttachments(prompt)
    expect(result.refs).toHaveLength(1)
    expect(result.refs[0]!.url).toBe("https://example.com/cat.png")
    expect(result.refs[0]!.path).toBeUndefined()
    await result.cleanup()
  })
})
