import { describe, expect, spyOn, test } from "bun:test"
import { SessionSummary } from "../../src/session/summary"
import { Session } from "../../src/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { NotFoundError } from "../../src/storage/db"
import { Bus } from "../../src/bus"
import { Storage } from "../../src/storage/storage"

describe("session.summary", () => {
  test("does not mutate the cached message object passed into summarize", async () => {
    const sessionID = SessionID.make("ses_summary_clone")
    const messageID = MessageID.make("msg_summary_clone")
    const messages = [
      {
        info: {
          id: messageID,
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-5.2" },
          summary: { diffs: [] },
        },
        parts: [],
      },
      {
        info: {
          id: MessageID.make("msg_summary_clone_assistant"),
          sessionID,
          role: "assistant",
          parentID: messageID,
          time: { created: Date.now() + 1 },
        },
        parts: [],
      },
    ] as any

    const setSummary = spyOn(Session, "setSummary").mockResolvedValue(undefined as any)
    const updateMessage = spyOn(Session, "updateMessage").mockResolvedValue(undefined as any)
    const publish = spyOn(Bus, "publish").mockResolvedValue(undefined as any)
    const storageWrite = spyOn(Storage, "write").mockResolvedValue(undefined as any)

    try {
      await SessionSummary.summarize({ sessionID, messageID }, messages)
      expect(messages[0].info.summary).toEqual({ diffs: [] })
      expect(updateMessage).toHaveBeenCalled()
    } finally {
      setSummary.mockRestore()
      updateMessage.mockRestore()
      publish.mockRestore()
      storageWrite.mockRestore()
    }
  })

  test("diff drops corrupt persisted session_diff payloads instead of crashing", async () => {
    const sessionID = SessionID.make("ses_summary_corrupt")
    for (const corrupt of [null, {}, 42, [{ file: 123 }]]) {
      const storageRead = spyOn(Storage, "read").mockResolvedValue(corrupt as any)
      try {
        expect(await SessionSummary.diff({ sessionID })).toEqual([])
      } finally {
        storageRead.mockRestore()
      }
    }
  })

  test("diff preserves valid entries when persisted session_diff has corrupt items", async () => {
    const sessionID = SessionID.make("ses_summary_partial_corrupt")
    const valid = {
      file: "src/app.ts",
      before: "old",
      after: "new",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }
    const storageRead = spyOn(Storage, "read").mockResolvedValue([valid, { file: 123 }] as any)
    try {
      expect(await SessionSummary.diff({ sessionID })).toEqual([valid])
    } finally {
      storageRead.mockRestore()
    }
  })

  test("rethrows non-NotFound errors even when another summary branch returns NotFound", async () => {
    const sessionID = SessionID.make("ses_summary_errors")
    const messageID = MessageID.make("msg_summary_errors")
    const messages = [
      {
        info: {
          id: messageID,
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-5.2" },
        },
        parts: [],
      },
    ] as any

    const setSummary = spyOn(Session, "setSummary").mockRejectedValue(new NotFoundError({ message: "missing" }))
    const updateMessage = spyOn(Session, "updateMessage").mockRejectedValue(new Error("boom"))
    const publish = spyOn(Bus, "publish").mockResolvedValue(undefined as any)
    const storageWrite = spyOn(Storage, "write").mockResolvedValue(undefined as any)

    try {
      await expect(SessionSummary.summarize({ sessionID, messageID }, messages)).rejects.toThrow("boom")
    } finally {
      setSummary.mockRestore()
      updateMessage.mockRestore()
      publish.mockRestore()
      storageWrite.mockRestore()
    }
  })
})
