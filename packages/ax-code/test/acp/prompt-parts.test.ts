import { describe, expect, test } from "vitest"
import { parsePromptParts } from "../../src/acp/prompt"

describe("ACP prompt parts", () => {
  test("a resource_link keeps a declared media type", () => {
    const parts = parsePromptParts([
      { type: "resource_link", uri: "file:///repo/chart.png", name: "chart.png", mimeType: "image/png" },
      { type: "resource_link", uri: "file:///repo/notes.md", name: "notes.md", mimeType: "text/markdown" },
      {
        type: "resource_link",
        uri: "file:///repo/spec.pdf",
        name: "spec.pdf",
        mimeType: " Application/PDF; charset=binary",
      },
    ] as any)
    expect(parts).toMatchObject([
      { type: "file", filename: "chart.png", mime: "image/png" },
      { type: "file", filename: "notes.md", mime: "text/plain" },
      { type: "file", filename: "spec.pdf", mime: "application/pdf" },
    ])
  })

  test("a blob resource without a mime type is attached, not dropped", () => {
    const parts = parsePromptParts([{ type: "resource", resource: { uri: "file:///x.bin", blob: "AAEC" } }] as any)
    expect(parts).toEqual([
      {
        type: "file",
        url: "data:application/octet-stream;base64,AAEC",
        filename: "x.bin",
        mime: "application/octet-stream",
      },
    ])
  })
})

describe("ACP prompt parts reject unsupported image media", () => {
  function fileParts(parts: ReturnType<typeof parsePromptParts>) {
    return parts.filter((part) => part.type === "file")
  }

  function textOf(parts: ReturnType<typeof parsePromptParts>) {
    return parts.map((part) => (part.type === "text" ? part.text : "")).join("\n")
  }

  test("an image part with mimeType image/heic becomes a text error", () => {
    const parts = parsePromptParts([{ type: "image", mimeType: "image/heic", data: "AAEC" }] as any)

    expect(fileParts(parts)).toEqual([])
    const text = textOf(parts)
    expect(text).toMatch(/unsupported/i)
    expect(text).toMatch(/image\/heic/)
  })

  test("a resource_link with mimeType image/bmp becomes a text error", () => {
    const parts = parsePromptParts([
      {
        type: "resource_link",
        uri: "file:///repo/photo.bmp",
        name: "photo.bmp",
        mimeType: "image/bmp",
      },
    ] as any)

    expect(fileParts(parts)).toEqual([])
    const text = textOf(parts)
    expect(text).toMatch(/unsupported/i)
    expect(text).toMatch(/image\/bmp/)
  })

  test("a resource blob with mimeType image/heic becomes a text error", () => {
    const parts = parsePromptParts([
      {
        type: "resource",
        resource: { uri: "file:///repo/photo.heic", blob: "AAEC", mimeType: "image/heic" },
      },
    ] as any)

    expect(fileParts(parts)).toEqual([])
    const text = textOf(parts)
    expect(text).toMatch(/unsupported/i)
    expect(text).toMatch(/image\/heic/)
  })

  test("a PNG image part still becomes a file part", () => {
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    const parts = parsePromptParts([{ type: "image", mimeType: "image/png", data: png }] as any)

    expect(parts).toMatchObject([
      { type: "file", url: `data:image/png;base64,${png}`, filename: "image", mime: "image/png" },
    ])
  })
})
