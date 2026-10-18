import { describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import {
  normalizeDocumentSymbolEnvelopeData,
  resolveFileAttachmentPart,
} from "../../src/session/prompt/prompt-file-attachment"
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
