import { afterEach, describe, expect, test } from "vitest"
import { ACPSessionManager } from "../../src/acp/session"
import type { ACPSessionState } from "../../src/acp/types"
import { Log } from "../../src/util/log"

function state(id: string): ACPSessionState {
  return {
    id,
    cwd: "/repo",
    mcpServers: [],
    createdAt: new Date(0),
  }
}

function createSdk() {
  return {
    session: {
      create: async () => ({ data: { id: "created", time: { created: 0 } } }),
      get: async ({ sessionID }: { sessionID: string }) => ({
        data: { id: sessionID, time: { created: 0 } },
      }),
    },
  } as any
}

afterEach(async () => {
  await Log.init({ print: false })
})

describe("ACP session manager", () => {
  test("refreshes least-recently-used order on access", () => {
    const manager = new ACPSessionManager(createSdk())
    const sessions = (manager as unknown as { sessions: Map<string, ACPSessionState> }).sessions
    sessions.set("old", state("old"))
    sessions.set("new", state("new"))

    expect(manager.tryGet("old")?.id).toBe("old")
    expect([...sessions.keys()]).toEqual(["new", "old"])

    expect(manager.get("new").id).toBe("new")
    expect([...sessions.keys()]).toEqual(["old", "new"])
  })

  test("does not log MCP header or environment credentials", async () => {
    const lines: string[] = []
    await Log.init({ print: true, level: "INFO" }, { stderrWrite: (line) => lines.push(line) })
    const manager = new ACPSessionManager(createSdk())

    await manager.create("/repo", [
      {
        name: "remote",
        url: "https://example.test/mcp",
        headers: [{ name: "Authorization", value: "Bearer super-secret-header" }],
      },
    ] as any)
    await manager.load("loaded", "/repo", [
      {
        name: "local",
        command: "server",
        args: [],
        env: [{ name: "API_KEY", value: "super-secret-environment" }],
      },
    ] as any)

    const output = lines.join("")
    expect(output).toContain("creating_session")
    expect(output).toContain("loading_session")
    expect(output).toContain("mcpServerCount=1")
    expect(output).not.toContain("super-secret-header")
    expect(output).not.toContain("super-secret-environment")
  })
})
