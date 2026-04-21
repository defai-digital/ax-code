import { describe, expect, test } from "bun:test"
import { handleMessageSyncEvent } from "../../../src/cli/cmd/tui/context/sync-message-event"

describe("tui sync message event", () => {
  test("routes message update and delete events to the message handlers", () => {
    const calls: string[] = []

    handleMessageSyncEvent(
      { type: "message.updated", properties: { info: { id: "msg_1", sessionID: "ses_1" } } },
      {
        updateMessage(sessionID, message) {
          calls.push(`update:${sessionID}:${message.id}`)
        },
        deleteMessage: () => undefined,
        updatePart: () => undefined,
        appendPartDelta: () => undefined,
        deletePart: () => undefined,
      },
    )

    const handled = handleMessageSyncEvent(
      { type: "message.removed", properties: { sessionID: "ses_1", messageID: "msg_2" } },
      {
        updateMessage: () => undefined,
        deleteMessage(sessionID, messageID) {
          calls.push(`delete:${sessionID}:${messageID}`)
        },
        updatePart: () => undefined,
        appendPartDelta: () => undefined,
        deletePart: () => undefined,
      },
    )

    expect(handled).toBe(true)
    expect(calls).toEqual([
      "update:ses_1:msg_1",
      "delete:ses_1:msg_2",
    ])
  })

  test("routes part update and remove events to the part handlers", () => {
    const calls: string[] = []

    handleMessageSyncEvent(
      { type: "message.part.updated", properties: { part: { id: "part_1", messageID: "msg_1" } } },
      {
        updateMessage: () => undefined,
        deleteMessage: () => undefined,
        updatePart(messageID, part) {
          calls.push(`update:${messageID}:${part.id}`)
        },
        appendPartDelta: () => undefined,
        deletePart: () => undefined,
      },
    )

    handleMessageSyncEvent(
      { type: "message.part.removed", properties: { messageID: "msg_1", partID: "part_2" } },
      {
        updateMessage: () => undefined,
        deleteMessage: () => undefined,
        updatePart: () => undefined,
        appendPartDelta: () => undefined,
        deletePart(messageID, partID) {
          calls.push(`delete:${messageID}:${partID}`)
        },
      },
    )

    expect(calls).toEqual([
      "update:msg_1:part_1",
      "delete:msg_1:part_2",
    ])
  })

  test("applies part deltas only for text field updates", () => {
    const calls: string[] = []

    handleMessageSyncEvent(
      { type: "message.part.delta", properties: { messageID: "msg_1", partID: "part_1", field: "json", delta: "{}" } },
      {
        updateMessage: () => undefined,
        deleteMessage: () => undefined,
        updatePart: () => undefined,
        appendPartDelta() {
          calls.push("unexpected")
        },
        deletePart: () => undefined,
      },
    )

    const handled = handleMessageSyncEvent(
      { type: "message.part.delta", properties: { messageID: "msg_1", partID: "part_1", field: "text", delta: "!" } },
      {
        updateMessage: () => undefined,
        deleteMessage: () => undefined,
        updatePart: () => undefined,
        appendPartDelta(messageID, partID, delta) {
          calls.push(`delta:${messageID}:${partID}:${delta}`)
        },
        deletePart: () => undefined,
      },
    )

    expect(handled).toBe(true)
    expect(calls).toEqual(["delta:msg_1:part_1:!"])
  })
})
