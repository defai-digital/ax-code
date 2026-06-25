import { describe, expect, test } from "vitest"
import { resolveUserMessageParts } from "../../src/session/prompt-message-parts"
import { MessageID, SessionID } from "../../src/session/schema"
import { Permission } from "../../src/permission"

describe("prompt message parts", () => {
  const sessionID = SessionID.make("session_prompt_message_parts")
  const messageID = MessageID.ascending()

  describe("agent instruction part", () => {
    test("agent part produces agent part and synthetic task-tool instruction", () => {
      const agentPermission = Permission.fromConfig({ task: "allow" })
      const result = resolveUserMessageParts({
        sessionID,
        messageID,
        agentName: "build",
        agentPermission,
        parts: [
          {
            type: "agent",
            name: "debug",
            source: { start: 0, end: 6, value: "@debug" },
          },
        ],
      })

      // resolveUserMessageParts is async but agentInstructionPart is sync —
      // the allSettled wrapper still resolves immediately.
      return result.then((parts) => {
        expect(parts.length).toBe(2)
        expect(parts[0]).toMatchObject({ type: "agent", name: "debug" })
        expect(parts[1]).toMatchObject({
          type: "text",
          synthetic: true,
        })
        expect((parts[1] as { text: string }).text).toContain("subagent: debug")
      })
    })

    test("agent part survives malformed (non-array) permission without throwing", () => {
      // Simulate the brittle error path: agentPermission is {} instead of a
      // normalized Permission.Ruleset array. The hardened code should fall
      // through to the default "ask" action instead of throwing
      // "Cannot read properties of undefined (reading 'replace')".
      const result = resolveUserMessageParts({
        sessionID,
        messageID,
        agentName: "build",
        agentPermission: {} as unknown as Permission.Ruleset,
        parts: [
          {
            type: "agent",
            name: "debug",
            source: { start: 0, end: 6, value: "@debug" },
          },
        ],
      })

      return result.then((parts) => {
        // Should not produce a synthetic failure attachment
        expect(parts.length).toBe(2)
        expect(parts[0]).toMatchObject({ type: "agent", name: "debug" })
        const synthetic = parts[1] as { text: string }
        expect(synthetic.text).not.toContain("Failed to resolve attachment")
        expect(synthetic.text).toContain("subagent: debug")
      })
    })

    test("agent part with deny permission includes guaranteed-existence hint", () => {
      const agentPermission = Permission.fromConfig({ task: "deny" })
      const result = resolveUserMessageParts({
        sessionID,
        messageID,
        agentName: "build",
        agentPermission,
        parts: [
          {
            type: "agent",
            name: "debug",
            source: { start: 0, end: 6, value: "@debug" },
          },
        ],
      })

      return result.then((parts) => {
        expect(parts.length).toBe(2)
        const synthetic = parts[1] as { text: string }
        expect(synthetic.text).toContain("Invoked by user; guaranteed to exist")
      })
    })
  })
})
