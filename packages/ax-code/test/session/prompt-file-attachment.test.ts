import { afterEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import {
  normalizeDocumentSymbolEnvelopeData,
  resolveFileAttachmentPart,
} from "../../src/session/prompt/prompt-file-attachment"
import { resolveMcpResourcePart } from "../../src/session/prompt/prompt-mcp-resource"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { MessageID, SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

describe("prompt file attachment", () => {
  test("normalizes malformed document symbol envelope payloads to an empty list", () => {
    expect(normalizeDocumentSymbolEnvelopeData(undefined)).toEqual([])
    expect(normalizeDocumentSymbolEnvelopeData(null)).toEqual([])
    expect(normalizeDocumentSymbolEnvelopeData({ name: "symbol" })).toEqual([])
  })

  test("preserves document symbol arrays for range expansion", () => {
    const symbols = [{ name: "symbol", range: { start: { line: 1 }, end: { line: 3 } } }]
    expect(normalizeDocumentSymbolEnvelopeData(symbols)).toEqual(symbols)
  })

  async function resolveInvalidAttachment(url: string) {
    const sessionID = SessionID.make("session_prompt_file_attachment")
    const messageID = MessageID.ascending()
    return resolveFileAttachmentPart({
      sessionID,
      messageID,
      agentName: "test",
      part: {
        type: "file",
        mime: "text/plain",
        filename: "bad.txt",
        url,
      },
      draftSyntheticTextPart: (text) => ({ type: "text", text, sessionID, messageID }),
      attachDraftContext: (part) => ({
        ...part,
        messageID,
        sessionID,
      }),
    })
  }

  test("invalid file part URLs become synthetic text instead of throwing", async () => {
    const parts = await resolveInvalidAttachment("not a url")
    expect(parts).toMatchObject([{ type: "text", text: "Invalid file URL: not a url" }])
  })

  test("file URLs that cannot become local paths become synthetic text", async () => {
    const url = "file://remote-host/tmp/bad.txt"
    const parts = await resolveInvalidAttachment(url)
    expect(parts).toMatchObject([{ type: "text", text: `Invalid file URL: ${url}` }])
  })

  test("fails closed when resize leaves an image over the configured limit", async () => {
    await using tmp = await tmpdir({
      // Every image is over this budget and resize is off, so the resizer
      // returns its explicit too_large marker instead of a resized buffer.
      config: { attachment: { image: { auto_resize: false, max_base64_bytes: 1 } } },
    })
    const filepath = path.join(tmp.path, "photo.png")
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
      "base64",
    )
    await fs.writeFile(filepath, png)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("session_attachment_too_large")
        const messageID = MessageID.ascending()
        const parts = await resolveFileAttachmentPart({
          sessionID,
          messageID,
          agentName: "test",
          part: {
            type: "file",
            mime: "image/png",
            filename: "photo.png",
            url: pathToFileURL(filepath).href,
          },
          draftSyntheticTextPart: (text) => ({ type: "text", text, sessionID, messageID }),
          attachDraftContext: (part) => ({ ...part, messageID, sessionID }),
        })

        // The original bytes must never be embedded past the caller's budget.
        expect(JSON.stringify(parts)).toContain("Attachment too large")
        expect(parts.some((part) => part.type === "file")).toBe(false)
      },
    })
  })

  test("rejects an oversized attachment from the stat without reading the file", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "huge.png")
    await fs.writeFile(filepath, "")
    // Sparse file: the size guard must fire before any read allocates it.
    await fs.truncate(filepath, 50 * 1024 * 1024 + 1)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("session_oversized_attachment")
        const messageID = MessageID.ascending()
        const readBytes = vi.spyOn(Filesystem, "readBytes")
        try {
          const parts = await resolveFileAttachmentPart({
            sessionID,
            messageID,
            agentName: "test",
            part: {
              type: "file",
              mime: "image/png",
              filename: "huge.png",
              url: pathToFileURL(filepath).href,
            },
            draftSyntheticTextPart: (text) => ({ type: "text", text, sessionID, messageID }),
            attachDraftContext: (part) => ({ ...part, messageID, sessionID }),
          })
          expect(JSON.stringify(parts)).toContain("Attachment too large")
          expect(readBytes.mock.calls.filter(([candidate]) => candidate === filepath)).toEqual([])
        } finally {
          readBytes.mockRestore()
        }
      },
    })
  })
})

describe("prompt file attachment rejects unsupported image media", () => {
  function fileParts(parts: Awaited<ReturnType<typeof resolveFileAttachmentPart>>) {
    return parts.filter((part) => part.type === "file")
  }

  function textOf(parts: Awaited<ReturnType<typeof resolveFileAttachmentPart>>) {
    return parts.map((part) => (part.type === "text" ? part.text : "")).join("\n")
  }

  test("a data image/heic part becomes a readable error instead of a file part", async () => {
    const sessionID = SessionID.make("session_attachment_heic_data")
    const messageID = MessageID.ascending()
    const parts = await resolveFileAttachmentPart({
      sessionID,
      messageID,
      agentName: "test",
      part: {
        type: "file",
        mime: "image/heic",
        filename: "photo.heic",
        url: "data:image/heic;base64,AAEC",
      },
      draftSyntheticTextPart: (text) => ({ type: "text", text, sessionID, messageID }),
      attachDraftContext: (part) => ({ ...part, messageID, sessionID }),
    })

    expect(fileParts(parts)).toEqual([])
    const text = textOf(parts)
    expect(text).toMatch(/unsupported/i)
    expect(text).toMatch(/image\/heic/)
  })

  test("a BMP file attachment is rejected without reading the file", async () => {
    // Pin a username so the config loader never falls back to os.userInfo(),
    // which is unavailable in the sandbox and would mask the attachment path.
    await using tmp = await tmpdir({ config: { username: "test" } })
    const filepath = path.join(tmp.path, "photo.bmp")
    const bmp = Buffer.from(
      "424d3a0000000000000036000000280000000100000001000000010018000000000004000000130b0000130b00000000000000000000",
      "hex",
    )
    await fs.writeFile(filepath, bmp)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("session_attachment_bmp_file")
        const messageID = MessageID.ascending()
        const readBytes = vi.spyOn(Filesystem, "readBytes")
        try {
          const parts = await resolveFileAttachmentPart({
            sessionID,
            messageID,
            agentName: "test",
            part: {
              type: "file",
              mime: "image/bmp",
              filename: "photo.bmp",
              url: pathToFileURL(filepath).href,
            },
            draftSyntheticTextPart: (text) => ({ type: "text", text, sessionID, messageID }),
            attachDraftContext: (part) => ({ ...part, messageID, sessionID }),
          })

          // Soft assertions so the red run surfaces every unmet part of the
          // contract: no file part, a readable error, and no file read.
          expect.soft(fileParts(parts)).toEqual([])
          const text = textOf(parts)
          expect.soft(text).toMatch(/unsupported/i)
          expect.soft(text).toMatch(/image\/bmp/)
          expect.soft(readBytes.mock.calls.filter(([candidate]) => candidate === filepath)).toEqual([])
        } finally {
          readBytes.mockRestore()
        }
      },
    })
  })
})

describe("prompt MCP resource attachment", () => {
  const MCP_URI = "mcp://docs/readme.md"

  afterEach(() => {
    vi.restoreAllMocks()
  })

  type ResourceContent = {
    uri: string
    mimeType: string
    blob: string
  }

  async function resolveResource(content: ResourceContent, mime: string) {
    const sessionID = SessionID.make("session_prompt_mcp_resource")
    const messageID = MessageID.ascending()
    const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
    const read = vi.spyOn(MCP, "readResource").mockResolvedValue({
      contents: [content],
    } as Awaited<ReturnType<typeof MCP.readResource>>)

    const parts = await resolveMcpResourcePart({
      sessionID,
      agentName: "test",
      agentPermission: [],
      part: {
        type: "file",
        mime,
        filename: "resource.bin",
        url: MCP_URI,
        source: {
          type: "resource",
          text: { start: 0, end: 0, value: "" },
          clientName: "docs",
          uri: MCP_URI,
        },
      },
      draftSyntheticTextPart: (text) => ({ type: "text", text, sessionID, messageID }),
      attachDraftContext: (part) => ({ ...part, messageID, sessionID }),
    })

    expect(ask).toHaveBeenCalledOnce()
    expect(read).toHaveBeenCalledWith("docs", MCP_URI)
    return parts
  }

  function fileParts(parts: Awaited<ReturnType<typeof resolveMcpResourcePart>>) {
    return parts.filter((part) => part.type === "file")
  }

  test("decodes a text/markdown blob without attaching the MCP URI", async () => {
    const parts = await resolveResource(
      {
        uri: MCP_URI,
        mimeType: "text/markdown",
        blob: Buffer.from("# Notes", "utf8").toString("base64"),
      },
      "text/markdown",
    )

    expect(parts.every((part) => part.type === "text")).toBe(true)
    expect(parts.map((part) => ("text" in part ? part.text : "")).join("\n")).toContain("# Notes")
  })

  test("decodes PNG bytes into a data image URL file part", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
      "base64",
    )
    const parts = await resolveResource(
      {
        uri: MCP_URI,
        mimeType: "image/png",
        blob: png.toString("base64"),
      },
      "image/png",
    )

    const files = fileParts(parts)
    expect(files).toHaveLength(1)
    const url = files[0]?.url ?? ""
    expect(url).toMatch(/^data:image\/png;base64,/)
    expect(url).not.toContain("mcp://")
  })

  test("keeps malformed base64 as a binary label without decoding or attaching it", async () => {
    const parts = await resolveResource(
      {
        uri: MCP_URI,
        mimeType: "image/png",
        blob: "not base64!!!",
      },
      "image/png",
    )

    expect(fileParts(parts)).toEqual([])
    const text = parts.map((part) => ("text" in part ? part.text : "")).join("\n")
    expect(text).toMatch(/Binary content.*image\/png/)
    // Exactly one label and no decoded payload or failure marker.
    expect(text.match(/Binary content/g)).toHaveLength(1)
    expect(text).not.toContain("not base64")
    expect(text).not.toContain("Failed to read MCP resource")
  })

  test("keeps BMP bytes as a binary label without a file part", async () => {
    const bmp = Buffer.from(
      "424d3a0000000000000036000000280000000100000001000000010018000000000004000000130b0000130b00000000000000000000",
      "hex",
    )
    const parts = await resolveResource(
      {
        uri: MCP_URI,
        mimeType: "image/bmp",
        blob: bmp.toString("base64"),
      },
      "image/bmp",
    )

    expect(fileParts(parts)).toEqual([])
    expect(parts.map((part) => ("text" in part ? part.text : "")).join("\n")).toMatch(/Binary content.*image\/bmp/)
  })

  test("decodes PDF bytes into a data application URL file part", async () => {
    const pdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
      "utf8",
    )
    const parts = await resolveResource(
      {
        uri: MCP_URI,
        mimeType: "application/pdf",
        blob: pdf.toString("base64"),
      },
      "application/pdf",
    )

    const files = fileParts(parts)
    expect(files).toHaveLength(1)
    const url = files[0]?.url ?? ""
    expect(url).toMatch(/^data:application\/pdf;base64,/)
    expect(url).not.toContain("mcp://")
  })
})
