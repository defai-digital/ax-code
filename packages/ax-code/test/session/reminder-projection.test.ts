import { expect, test } from "vitest"
import { projectTailReminders } from "../../src/session/reminder-projection"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"

function messages(hint: string): MessageV2.WithParts[] {
  const sessionID = SessionID.make("ses_projection")
  const messageID = MessageID.make("msg_projection")
  const part = { id: PartID.make("prt_projection"), sessionID, messageID, type: "text" as const }
  return [
    {
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
      },
      parts: [
        { ...part, text: "original request" },
        { ...part, text: "plan restriction", synthetic: true },
        { ...part, text: hint, synthetic: true, metadata: { axDynamicReminder: true } },
        { ...part, text: "user supplied metadata", metadata: { axDynamicReminder: true } },
      ],
    },
  ]
}

test("changing dynamic state preserves original content and ordering without mutating history", () => {
  const source = messages("todo: investigate")
  const before = JSON.stringify(source)
  const a = projectTailReminders(source)
  const b = projectTailReminders(messages("todo: verify"))
  expect(a.messages).toEqual(b.messages)
  expect(a.reminder).toBe("todo: investigate")
  expect(b.reminder).toBe("todo: verify")
  expect(a.messages[0].parts.map((part) => part.type === "text" && part.text)).toEqual([
    "original request",
    "plan restriction",
    "user supplied metadata",
  ])
  expect(JSON.stringify(source)).toBe(before)
  expect(projectTailReminders(a.messages).reminder).toBeUndefined()
})
