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

  test("binary resource blobs keep a readable label without an unusable file part", () => {
    const parts = parsePromptParts([
      { type: "resource", resource: { uri: "file:///x.bin", blob: "AAEC" } },
      {
        type: "resource",
        resource: { uri: "file:///y.bin", blob: "AAEC", mimeType: "application/octet-stream" },
      },
    ] as any)
    expect(parts).toEqual([
      { type: "text", text: "[Binary content: application/octet-stream]" },
      { type: "text", text: "[Binary content: application/octet-stream]" },
    ])
  })

  test("decodes textual resource blobs and retains supported PDF media", () => {
    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64")
    const parts = parsePromptParts([
      {
        type: "resource",
        resource: {
          uri: "file:///notes.md",
          blob: Buffer.from("# Notes").toString("base64"),
          mimeType: "text/markdown",
        },
      },
      { type: "resource", resource: { uri: "file:///spec.pdf", blob: pdf, mimeType: "application/pdf" } },
    ] as any)
    expect(parts).toEqual([
      { type: "text", text: "# Notes" },
      { type: "file", url: `data:application/pdf;base64,${pdf}`, filename: "spec.pdf", mime: "application/pdf" },
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
