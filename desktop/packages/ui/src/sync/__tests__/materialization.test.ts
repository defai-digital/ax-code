import { describe, expect, test } from "vitest"
import type { Message, Part } from "@ax-code/sdk/v2/client"
import { getSessionMaterializationStatus, materializeSessionSnapshots } from "../materialization"

function message(id: string, sessionID = "ses_1"): Message {
  return { id, sessionID, role: "assistant", time: { created: 1 } } as Message
}

function userMessage(id: string, sessionID = "ses_1"): Message {
  return { id, sessionID, role: "user", time: { created: 1 } } as Message
}

function part(id: string, messageID: string, type = "text", text = id): Part {
  return { id, messageID, sessionID: "ses_1", type, text } as Part
}

describe("materializeSessionSnapshots", () => {
  test("materializes messages and parts together", () => {
    const result = materializeSessionSnapshots({ message: {}, part: {} }, "ses_1", [
      { info: message("msg_1"), parts: [part("prt_1", "msg_1")] },
    ])

    expect(result.message.ses_1.map((item) => item.id)).toEqual(["msg_1"])
    expect(result.part.msg_1.map((item) => item.id)).toEqual(["prt_1"])
    expect(result.messagesChanged).toBe(true)
    expect(result.partsChanged).toBe(true)
  })

  test("updates an existing message whose info changed in the snapshot", () => {
    // Reconnect recovery: an assistant reply that completed server-side while
    // disconnected must overwrite the stale in-progress copy (same id).
    const inProgress = { id: "msg_1", sessionID: "ses_1", role: "assistant", time: { created: 1 } } as Message
    const completed = {
      id: "msg_1",
      sessionID: "ses_1",
      role: "assistant",
      time: { created: 1, completed: 9 },
      finish: "stop",
    } as unknown as Message
    const state = { message: { ses_1: [inProgress] }, part: { msg_1: [part("prt_1", "msg_1")] } }

    const result = materializeSessionSnapshots(state, "ses_1", [{ info: completed, parts: [part("prt_1", "msg_1")] }])

    expect(result.messagesChanged).toBe(true)
    const merged = result.message.ses_1.find((item) => item.id === "msg_1") as Message & {
      time?: { completed?: number }
    }
    expect(merged.time?.completed).toBe(9)
  })

  test("preserves unchanged references", () => {
    const existingMessage = message("msg_1")
    const existingPart = part("prt_1", "msg_1")
    const state = { message: { ses_1: [existingMessage] }, part: { msg_1: [existingPart] } }

    const result = materializeSessionSnapshots(state, "ses_1", [{ info: existingMessage, parts: [existingPart] }])

    expect(result.message).toBe(state.message)
    expect(result.part).toBe(state.part)
    expect(result.messagesChanged).toBe(false)
    expect(result.partsChanged).toBe(false)
  })

  test("skips non-rendered part types", () => {
    const result = materializeSessionSnapshots(
      { message: {}, part: {} },
      "ses_1",
      [{ info: message("msg_1"), parts: [part("prt_patch", "msg_1", "patch"), part("prt_text", "msg_1")] }],
      { skipPartTypes: new Set(["patch"]) },
    )

    expect(result.part.msg_1.map((item) => item.id)).toEqual(["prt_text"])
  })

  test("preserves newer live streaming text when a stale snapshot materializes", () => {
    const livePart = part("prt_1", "msg_1", "text", "First chunk ")
    const stalePart = part("prt_1", "msg_1", "text", "")
    const state = {
      message: { ses_1: [message("msg_1")] },
      part: { msg_1: [livePart] },
    }

    const result = materializeSessionSnapshots(state, "ses_1", [{ info: message("msg_1"), parts: [stalePart] }])

    expect(result.part.msg_1[0]).toBe(livePart)
    expect((result.part.msg_1[0] as { text?: string })?.text).toBe("First chunk ")
  })

  test("preserves live streaming text when a stale snapshot has an invalid end time", () => {
    const livePart = part("prt_1", "msg_1", "text", "First chunk ")
    const stalePart = { ...part("prt_1", "msg_1", "text", ""), time: { start: 20, end: 10 } } as Part
    const state = {
      message: { ses_1: [message("msg_1")] },
      part: { msg_1: [livePart] },
    }

    const result = materializeSessionSnapshots(state, "ses_1", [{ info: message("msg_1"), parts: [stalePart] }])

    expect((result.part.msg_1[0] as { text?: string })?.text).toBe("First chunk ")
  })

  test("preserves live streaming parts omitted by a stale snapshot", () => {
    const livePart = part("prt_1", "msg_1", "text", "First chunk ")
    const state = {
      message: { ses_1: [message("msg_1")] },
      part: { msg_1: [livePart] },
    }

    const result = materializeSessionSnapshots(state, "ses_1", [{ info: message("msg_1"), parts: [] }])

    expect(result.part.msg_1[0]).toBe(livePart)
  })

  test("does not preserve omitted optimistic user text parts beside server snapshot parts", () => {
    const optimisticPart = { id: "prt_optimistic", messageID: "msg_1", type: "text", text: "Hello" } as Part
    const serverPart = part("prt_server", "msg_1", "text", "Hello")
    const state = {
      message: { ses_1: [userMessage("msg_1")] },
      part: { msg_1: [optimisticPart] },
    }

    const result = materializeSessionSnapshots(state, "ses_1", [{ info: userMessage("msg_1"), parts: [serverPart] }])

    expect(result.part.msg_1).toEqual([serverPart])
  })
})

describe("getSessionMaterializationStatus", () => {
  test("requires assistant parts for renderable cached state", () => {
    const state = {
      message: { ses_1: [message("msg_1")] },
      part: {},
    }

    expect(getSessionMaterializationStatus(state, "ses_1")).toEqual({
      hasMessages: true,
      renderable: false,
      missingPartMessageIDs: ["msg_1"],
    })
  })

  test("treats user-only cached state as renderable", () => {
    const state = {
      message: { ses_1: [{ ...message("msg_1"), role: "user" } as Message] },
      part: {},
    }

    expect(getSessionMaterializationStatus(state, "ses_1")).toEqual({
      hasMessages: true,
      renderable: true,
      missingPartMessageIDs: [],
    })
  })
})
