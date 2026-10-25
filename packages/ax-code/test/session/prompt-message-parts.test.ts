import { describe, expect, test, vi } from "vitest"
import { resolveUserMessageParts } from "../../src/session/prompt/prompt-message-parts"
import { MessageID, SessionID } from "../../src/session/schema"
import { Permission } from "../../src/permission"
import { MCP } from "../../src/mcp"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

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

  describe("MCP resource permission", () => {
    test("applies session deny rules to MCP resource reads", async () => {
      await using tmp = await tmpdir({ git: true, config: { username: "test" } })
      const uri = "mcp://docs/private.txt"
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const session = await Session.create({
              permission: [
                { permission: MCP.permissionKey("mcp_resource", "docs"), pattern: "*", action: "deny" as const },
              ],
            })
            const read = vi.spyOn(MCP, "readResource").mockResolvedValue({
              contents: [{ uri, mimeType: "text/plain", text: "MCP PRIVATE NOTES" }],
            } as Awaited<ReturnType<typeof MCP.readResource>>)

            const parts = await resolveUserMessageParts({
              sessionID: session.id,
              messageID: MessageID.ascending(),
              agentName: "build",
              agentPermission: Permission.fromConfig({ "*": "allow" }),
              parts: [
                {
                  type: "file",
                  mime: "text/plain",
                  filename: "private.txt",
                  url: uri,
                  source: {
                    type: "resource",
                    text: { start: 0, end: 0, value: "" },
                    clientName: "docs",
                    uri,
                  },
                },
              ],
            })

            expect(read).not.toHaveBeenCalled()
            const text = parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
            expect(text).not.toContain("MCP PRIVATE NOTES")
          },
        })
      } finally {
        vi.restoreAllMocks()
        await Instance.disposeAll()
      }
    })
  })
})
