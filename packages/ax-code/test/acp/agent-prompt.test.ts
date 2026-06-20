import { describe, expect, test } from "vitest"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

function createPromptAgent() {
  const promptCalls: any[] = []
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
      messages: async () => ({ data: [] }),
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

  return { agent, promptCalls, stop: () => connectionAbort.abort() }
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
})
