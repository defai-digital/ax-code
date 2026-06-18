import { describe, expect, test } from "bun:test"
import { normalizeDocumentSymbolEnvelopeData, resolveFileAttachmentPart } from "../../src/session/prompt-file-attachment"
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

  test("invalid file part URLs become synthetic text instead of throwing", async () => {
    const sessionID = SessionID.make("session_prompt_file_attachment")
    const messageID = MessageID.ascending()
    const parts = await resolveFileAttachmentPart({
      sessionID,
      messageID,
      agentName: "test",
      part: {
        type: "file",
        mime: "text/plain",
        filename: "bad.txt",
        url: "not a url",
      },
      draftSyntheticTextPart: (text) => ({ type: "text", text, sessionID, messageID }),
      attachDraftContext: (part) => ({
        ...part,
        messageID,
        sessionID,
      }),
    })

    expect(parts).toEqual([{ type: "text", text: "Invalid file URL: not a url", sessionID, messageID }])
  })
})
