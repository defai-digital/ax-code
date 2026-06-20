import { describe, expect, test } from "vitest"
import {
  normalizeDocumentSymbolEnvelopeData,
  resolveFileAttachmentPart,
} from "../../src/session/prompt-file-attachment"
import { MessageID, SessionID } from "../../src/session/schema"

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
})
