import { describe, expect, test } from "vitest"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Regression test for: unstable_forkSession/unstable_resumeSession silently
// dropping the session's actual last-used agent mode, falling back to the
// default agent instead. "build" is listed first in app.agents() (the
// default-fallback candidate order loadAvailableModes/resolveModeState would
// pick if restoration didn't happen), while the session's last real user
// message was actually sent under "plan" — a restricted, non-default agent.
function createModeAgent(promptCalls: any[]) {
  const connectionAbort = new AbortController()
  const connection = {
    async sessionUpdate() {},
    async requestPermission() {
      return { outcome: { outcome: "selected", optionId: "once" } }
    },
    signal: connectionAbort.signal,
  } as unknown as AgentSideConnection

  const lastUserMessage = {
    info: {
      role: "user",
      sessionID: "ses_original",
      agent: "plan",
      model: { providerID: "opencode", modelID: "big-pickle" },
      time: { created: 0 },
    },
    parts: [],
  }

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => ({
        stream: (async function* () {
          await new Promise<void>((resolve) => {
            if (opts?.signal?.aborted) {
              resolve()
              return
            }
            opts?.signal?.addEventListener("abort", () => resolve(), { once: true })
          })
        })(),
      }),
    },
    session: {
      fork: async () => ({ data: { id: "ses_forked", time: { created: 0 } } }),
      get: async ({ sessionID }: { sessionID: string }) => ({
        data: { id: sessionID, time: { created: 0 } },
      }),
      messages: async () => ({ data: [lastUserMessage] }),
      prompt: async (params: any) => {
        promptCalls.push(params)
        return {
          data: {
            info: {
              role: "assistant",
              providerID: "opencode",
              modelID: "big-pickle",
              tokens: { input: 0, output: 0, reasoning: 0 },
            },
          },
        }
      },
    },
    config: {
      providers: async () => ({
        data: {
          providers: [
            {
              id: "opencode",
              name: "opencode",
              models: {
                "big-pickle": { id: "big-pickle", name: "big-pickle", limit: { context: 1000 } },
              },
            },
          ],
        },
      }),
    },
    app: {
      agents: async () => ({
        data: [
          { name: "build", description: "build", mode: "primary", tier: "core", permission: [] },
          { name: "plan", description: "plan", mode: "primary", tier: "core", permission: [] },
        ],
      }),
    },
    command: {
      list: async () => ({ data: [] }),
    },
    mcp: {
      add: async () => ({ data: true }),
    },
  } as any

  const agent = new ACP.Agent(connection, {
    sdk,
    defaultModel: { providerID: "opencode", modelID: "big-pickle" },
  } as any)

  return { agent, stop: () => connectionAbort.abort() }
}

describe("ACP fork/resume session mode restoration", () => {
  test("unstable_forkSession restores the last-used agent mode, not the default", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promptCalls: any[] = []
        const { agent, stop } = createModeAgent(promptCalls)
        try {
          const result = await agent.unstable_forkSession({
            sessionId: "ses_original",
            cwd: tmp.path,
            mcpServers: [],
          } as any)

          expect(result.modes?.currentModeId).toBe("plan")
          expect(result.models?.currentModelId).toContain("big-pickle")

          await agent.prompt({
            sessionId: "ses_forked",
            prompt: [{ type: "text", text: "hi" }],
          } as any)

          expect(promptCalls).toHaveLength(1)
          expect(promptCalls[0].agent).toBe("plan")
        } finally {
          stop()
        }
      },
    })
  })

  test("unstable_resumeSession restores the last-used agent mode, not the default", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const promptCalls: any[] = []
        const { agent, stop } = createModeAgent(promptCalls)
        try {
          const result = await agent.unstable_resumeSession({
            sessionId: "ses_original",
            cwd: tmp.path,
            mcpServers: [],
          } as any)

          expect(result.modes?.currentModeId).toBe("plan")
          expect(result.models?.currentModelId).toContain("big-pickle")

          await agent.prompt({
            sessionId: "ses_original",
            prompt: [{ type: "text", text: "hi" }],
          } as any)

          expect(promptCalls).toHaveLength(1)
          expect(promptCalls[0].agent).toBe("plan")
        } finally {
          stop()
        }
      },
    })
  })
})
