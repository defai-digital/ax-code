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
