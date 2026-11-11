import { afterEach, expect, test, vi, type MockInstance } from "vitest"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { executePromptCommand } from "../../src/session/prompt/prompt-command-execution"
import type { PromptInput } from "../../src/session/prompt/prompt-input"
import { tmpdir } from "../fixture/fixture"

const model: Provider.Model = {
  id: "test-model" as any,
  providerID: "test" as any,
  name: "Test",
  family: "test",
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai-compatible",
  },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  limit: {
    context: 128_000,
    output: 8_192,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

const cliModel: Provider.Model = {
  ...model,
  id: "claude-code" as any,
  providerID: "claude-code" as any,
}

let modelSpy: MockInstance | undefined

afterEach(async () => {
  modelSpy?.mockRestore()
  modelSpy = undefined
  await Instance.disposeAll()
})

test("preserves explicit skill command agent during prompt execution", async () => {
  await using tmp = await tmpdir({ git: true })
  modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
  const calls: PromptInput[] = []

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})

      await executePromptCommand(
        {
          sessionID: session.id,
          command: "debug",
          arguments: "broken command",
          system: "Reply in Japanese. Preserve project rules.",
          agent: "architect",
          model: "test/test-model",
        },
        async (input) => {
          calls.push(input)
          return {
            info: {
              id: "msg_command_test" as any,
              sessionID: session.id,
              role: "assistant",
              time: { created: Date.now() },
              agent: input.agent ?? "debug",
              model: input.model,
            },
            parts: [],
          } as any
        },
      )
    },
  })

  expect(calls).toHaveLength(1)
  expect(calls[0].system).toBe("Reply in Japanese. Preserve project rules.")
  expect(calls[0].agent).toBe("debug")
  expect(calls[0].agentRouting).toBe("preserve")
})

test("allows optional-argument /debug with an empty argument list", async () => {
  await using tmp = await tmpdir({ git: true })
  modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
  const calls: PromptInput[] = []

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})

      await executePromptCommand(
        {
          sessionID: session.id,
          command: "debug",
          arguments: "",
          agent: "architect",
          model: "test/test-model",
        },
        async (input) => {
          calls.push(input)
          return {
            info: {
              id: "msg_command_debug_optional" as any,
              sessionID: session.id,
              role: "assistant",
              time: { created: Date.now() },
              agent: input.agent ?? "debug",
              model: input.model,
            },
            parts: [],
          } as any
        },
      )
    },
  })

  expect(calls).toHaveLength(1)
  expect(calls[0].agent).toBe("debug")
})

test("rejects built-in council and arena commands on a CLI-provider model", async () => {
  await using tmp = await tmpdir({ git: true })
  modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(cliModel)
  const calls: PromptInput[] = []

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})

      for (const command of ["council", "arena"]) {
        await expect(
          executePromptCommand(
            {
              sessionID: session.id,
              command,
              arguments: "review auth",
              model: "claude-code/claude-code",
            },
            async (input) => {
              calls.push(input)
              return {
                info: {
                  id: `msg_${command}_cli` as any,
                  sessionID: session.id,
                  role: "assistant",
                  time: { created: Date.now() },
                  agent: input.agent ?? "build",
                  model: input.model,
                },
                parts: [],
              } as any
            },
          ),
        ).rejects.toThrow(/needs a non-CLI \(API\) model/)
      }
    },
  })

  expect(calls).toHaveLength(0)
})

test("keeps other built-ins and custom commands working on a CLI-provider model", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: { command: { "team-review": { template: "Review $ARGUMENTS" } } },
  })
  modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(cliModel)
  const calls: PromptInput[] = []

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})

      for (const command of ["debug", "team-review"]) {
        await executePromptCommand(
          {
            sessionID: session.id,
            command,
            arguments: "auth",
            model: "claude-code/claude-code",
          },
          async (input) => {
            calls.push(input)
            return {
              info: {
                id: `msg_${command}_cli` as any,
                sessionID: session.id,
                role: "assistant",
                time: { created: Date.now() },
                agent: input.agent ?? "build",
                model: input.model,
              },
              parts: [],
            } as any
          },
        )
      }
    },
  })

  expect(calls).toHaveLength(2)
})

test("rejects /council on a non-bundled *-cli provider", async () => {
  await using tmp = await tmpdir({ git: true })
  modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue({
    ...cliModel,
    id: "acme" as any,
    providerID: "acme-cli" as any,
  })
  const calls: PromptInput[] = []

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})

      await expect(
        executePromptCommand(
          {
            sessionID: session.id,
            command: "council",
            arguments: "review auth",
            model: "acme-cli/acme",
          },
          async (input) => {
            calls.push(input)
            throw new Error("prompt should not run")
          },
        ),
      ).rejects.toThrow(/needs a non-CLI \(API\) model/)
    },
  })

  expect(calls).toHaveLength(0)
})

test("rejects the CLI-model command without validating the model", async () => {
  await using tmp = await tmpdir({ git: true })
  modelSpy = vi.spyOn(Provider, "getModel").mockRejectedValue(new Error("model lookup failed"))

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})

      await expect(
        executePromptCommand(
          {
            sessionID: session.id,
            command: "council",
            arguments: "review auth",
            model: "claude-code/claude-code",
          },
          async () => {
            throw new Error("prompt should not run")
          },
        ),
      ).rejects.toThrow(/needs a non-CLI \(API\) model/)
    },
  })

  expect(modelSpy).not.toHaveBeenCalled()
})

test("uses the build agent's pinned model for the CLI-model guard", async () => {
  const calls: PromptInput[] = []

  // build pinned to an API model: a CLI request model is NOT rejected because
  // the command will actually run on the pinned API model.
  await using pinnedApi = await tmpdir({
    git: true,
    config: { agent: { build: { model: "test/test-model" } } },
  })
  modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
  await Instance.provide({
    directory: pinnedApi.path,
    fn: async () => {
      const session = await Session.create({})
      await executePromptCommand(
        {
          sessionID: session.id,
          command: "council",
          arguments: "review auth",
          model: "claude-code/claude-code",
        },
        async (input) => {
          calls.push(input)
          return {
            info: {
              id: "msg_council_pinned_api" as any,
              sessionID: session.id,
              role: "assistant",
              time: { created: Date.now() },
              agent: input.agent ?? "build",
              model: input.model,
            },
            parts: [],
          } as any
        },
      )
    },
  })
  expect(calls).toHaveLength(1)
  modelSpy.mockRestore()

  // build pinned to a CLI model: an API request model IS rejected because the
  // command will actually run on the pinned CLI model.
  await using pinnedCli = await tmpdir({
    git: true,
    config: { agent: { build: { model: "claude-code/claude-code" } } },
  })
  modelSpy = vi.spyOn(Provider, "getModel").mockResolvedValue(model)
  await Instance.provide({
    directory: pinnedCli.path,
    fn: async () => {
      const session = await Session.create({})
      await expect(
        executePromptCommand(
          {
            sessionID: session.id,
            command: "council",
            arguments: "review auth",
            model: "test/test-model",
          },
          async () => {
            throw new Error("prompt should not run")
          },
        ),
      ).rejects.toThrow(/needs a non-CLI \(API\) model/)
    },
  })
})
