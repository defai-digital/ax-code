import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import type { Agent } from "../../src/agent/agent"
import { Plugin } from "../../src/plugin"
import { Config } from "../../src/config/config"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionProcessor } from "../../src/session/processor"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { loopMessages } from "../../src/session/prompt/prompt-loop-messages"
import { preparePromptRequest } from "../../src/session/prompt/prompt-request-build"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const model = {
  id: ModelID.make("test-model"),
  providerID: ProviderID.make("test"),
  api: { id: "test-model", url: "https://example.test/v1", npm: "@ai-sdk/openai-compatible" },
  limit: { context: 32000, output: 4000 },
  capabilities: { input: { text: true }, toolcall: true },
  options: {},
} as Provider.Model

async function writeUser(sessionID: SessionID, text: string) {
  const info: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: model.providerID, modelID: model.id },
  }
  return Session.updateMessageWithParts(info, [
    {
      id: PartID.ascending(),
      messageID: info.id,
      sessionID,
      type: "text",
      text,
      metadata: { historyProbe: { original: true } },
    },
  ])
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function historyPluginFixture() {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  return tmpdir({
    init: async (directory) => {
      const plugins = path.join(directory, ".ax-code", "plugin")
      await fs.mkdir(plugins, { recursive: true })
      await fs.writeFile(
        path.join(plugins, "history.ts"),
        `
        export default async () => ({
          "experimental.chat.messages.transform": async (_input, output) => {
            for (const message of output.messages) {
              for (const part of message.parts) {
                if (part.type !== "text") continue
                part.text += " [request-only]"
                part.metadata.historyProbe.original = false
              }
            }
          }
        })
      `,
      )
    },
  })
}

test.each([false, true])("message transforms cannot alter cached history (bounded projection=%s)", async (bounded) => {
  await using tmp = await historyPluginFixture()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        const session = await Session.create({})
        await writeUser(session.id, "Previous context")
        const current = await writeUser(session.id, "Current request")
        const messages = await Session.messages({ sessionID: session.id })
        const before = structuredClone(messages)
        const requestMessagesSource = bounded ? messages.slice(-1) : undefined
        const input = {
          sessionID: session.id,
          messages,
          lastUser: current.info as MessageV2.User,
          requestMessagesSource,
          step: 1,
          isLastStep: false,
          agent: { name: "build", mode: "primary", options: {}, permission: [] } satisfies Agent.Info,
          model,
          cache: {},
          structuredPrompt: "",
          environmentOverride: [],
          compactTurn: true,
        }
        const first = await preparePromptRequest(input)
        const second = await preparePromptRequest(input)
        expect(JSON.stringify(first.requestMessages)).toContain("Current request [request-only]")
        expect(second.requestMessages).toEqual(first.requestMessages)
        expect(messages).toEqual(before)
        expect(first.messages).toEqual(before)
        expect(await Session.messages({ sessionID: session.id })).toEqual(before)
        expect(first.requestMessagesSource).toHaveLength(bounded ? 1 : 2)
        expect((await Plugin.list()).some((hook) => hook["experimental.chat.messages.transform"])).toBe(true)
      } finally {
        await Instance.dispose()
      }
    },
  })
})

test("an empty history cache reloads newly written messages without an undefined cursor", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const initial = await loopMessages({ sessionID: session.id })
      expect(initial.cached).toEqual([])
      const current = await writeUser(session.id, "New request")
      const refreshed = await loopMessages({ sessionID: session.id, cached: initial.cached })
      expect(refreshed.msgs).toEqual([current])
    },
  })
})

test("compaction retries transform fresh history without rewriting the source transcript", async () => {
  await using tmp = await historyPluginFixture()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        const config = await Config.get()
        config.llm_routing = { fallback: [{ providerID: "test", modelID: "test-model" }] }
        vi.spyOn(Provider, "getSmallModel").mockResolvedValue({ ...model, id: ModelID.make("test-small") })
        vi.spyOn(Provider, "getModel").mockResolvedValue(model)
        const attempts: string[] = []
        vi.spyOn(SessionProcessor, "create").mockImplementation(
          (input) =>
            ({
              message: input.assistantMessage,
              process: async (request) => {
                attempts.push(JSON.stringify(request.messages))
                if (attempts.length === 1) {
                  input.assistantMessage.error = new MessageV2.APIError({
                    message: "Service unavailable",
                    statusCode: 503,
                    isRetryable: true,
                  }).toObject()
                  return "stop"
                }
                return "continue"
              },
            }) as SessionProcessor.Info,
        )
        const session = await Session.create({})
        const current = await writeUser(session.id, "Current request")
        const messages = await Session.messages({ sessionID: session.id })
        const before = structuredClone(messages)
        expect(
          await SessionCompaction.process({
            sessionID: session.id,
            parentID: current.info.id,
            messages,
            auto: false,
            abort: new AbortController().signal,
          }),
        ).toBe("continue")
        expect(attempts).toHaveLength(2)
        expect(attempts[1]).toBe(attempts[0])
        expect(attempts[0]).toContain("Current request [request-only]")
        expect(messages).toEqual(before)
      } finally {
        await Instance.dispose()
      }
    },
  })
})
