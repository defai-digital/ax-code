import { describe, expect, test } from "vitest"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function createPromptAgent(options?: { failOnThrowOnError?: boolean }) {
  const failOnThrowOnError = options?.failOnThrowOnError ?? false
  const promptCalls: any[] = []
  const commandCalls: any[] = []
  const connectionAbort = new AbortController()
  const connection = {
    async sessionUpdate() {},
    async requestPermission() {
      return { outcome: { outcome: "selected", optionId: "once" } }
    },
    signal: connectionAbort.signal,
  } as unknown as AgentSideConnection

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
      create: async () => ({
        data: {
          id: "ses_prompt",
          time: { created: new Date().toISOString() },
        },
      }),
      prompt: async (params: any, request?: any) => {
        promptCalls.push(params)
        if (failOnThrowOnError) {
          // hey-api v2 only rejects when the caller opts in via throwOnError;
          // otherwise a non-2xx response resolves with no data.
          if (request?.throwOnError) throw new Error("session.prompt failed: 500 Internal Server Error")
          return { data: undefined, error: { message: "Internal Server Error" } }
        }
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
      messages: async () => ({ data: [] }),
      command: async (params: any, request?: any) => {
        commandCalls.push(params)
        if (failOnThrowOnError) {
          if (request?.throwOnError) throw new Error("session.command failed: 500 Internal Server Error")
          return { data: undefined, error: { message: "Internal Server Error" } }
        }
        return { data: { info: { role: "assistant", tokens: { input: 0, output: 0, reasoning: 0 } } } }
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
        data: [{ name: "build", description: "build", mode: "agent" }],
      }),
    },
    command: {
      list: async () => ({ data: [{ name: "review" }] }),
    },
    mcp: {
      add: async () => ({ data: true }),
    },
  } as any

  const agent = new ACP.Agent(connection, {
    sdk,
    defaultModel: { providerID: "opencode", modelID: "big-pickle" },
  } as any)

  return { agent, promptCalls, commandCalls, stop: () => connectionAbort.abort() }
}

describe("ACP agent prompt", () => {
  test("keeps remote image URLs with case-insensitive HTTP schemes", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, promptCalls, stop } = createPromptAgent()

        try {
          const { sessionId } = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)

          await agent.prompt({
            sessionId,
            prompt: [
              { type: "text", text: "look at this" },
              { type: "image", uri: "HTTPS://example.com/screenshot.png", mimeType: "image/png" },
            ],
          } as any)

          expect(promptCalls).toHaveLength(1)
          expect(promptCalls[0].parts).toContainEqual({
            type: "file",
            url: "HTTPS://example.com/screenshot.png",
            filename: "image",
            mime: "image/png",
          })
        } finally {
          stop()
        }
      },
    })
  })

  test("submits an unknown slash-prefixed prompt as ordinary text", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, promptCalls, stop } = createPromptAgent()

        try {
          const { sessionId } = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)
          await agent.prompt({
            sessionId,
            prompt: [{ type: "text", text: "/not-a-command keep this text" }],
          } as any)

          expect(promptCalls).toHaveLength(1)
          expect(promptCalls[0].parts).toEqual([{ type: "text", text: "/not-a-command keep this text" }])
        } finally {
          stop()
        }
      },
    })
  })

  test("a slash command keeps the session's selected variant", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, commandCalls, stop } = createPromptAgent()

        try {
          const { sessionId } = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)
          ;(agent as any).sessionManager.setVariant(sessionId, "high")
          await agent.prompt({ sessionId, prompt: [{ type: "text", text: "/review src" }] } as any)

          expect(commandCalls).toHaveLength(1)
          expect(commandCalls[0]).toMatchObject({ command: "review", variant: "high" })
        } finally {
          stop()
        }
      },
    })
  })

  test("a failed session.prompt rejects instead of reporting end_turn", async () => {
    // `config.username` keeps this hermetic where os.userInfo() is unavailable.
    await using tmp = await tmpdir({ config: { username: "test" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, promptCalls, stop } = createPromptAgent({ failOnThrowOnError: true })

        try {
          const { sessionId } = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)

          await expect(agent.prompt({ sessionId, prompt: [{ type: "text", text: "hello" }] } as any)).rejects.toThrow(
            /session\.prompt failed/,
          )
          expect(promptCalls).toHaveLength(1)
        } finally {
          stop()
        }
      },
    })
  })

  test("a failed session.command rejects instead of reporting end_turn", async () => {
    await using tmp = await tmpdir({ config: { username: "test" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, commandCalls, stop } = createPromptAgent({ failOnThrowOnError: true })

        try {
          const { sessionId } = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)

          await expect(
            agent.prompt({ sessionId, prompt: [{ type: "text", text: "/review src" }] } as any),
          ).rejects.toThrow(/session\.command failed/)
          expect(commandCalls).toHaveLength(1)
        } finally {
          stop()
        }
      },
    })
  })
})
