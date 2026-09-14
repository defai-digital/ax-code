import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID } from "../../src/session/schema"
import { TaskTool } from "../../src/tool/task"
import { TaskParallelTool } from "../../src/tool/task_parallel"
import { tmpdir } from "../fixture/fixture"

afterEach(() => vi.restoreAllMocks())

test.each([
  { parallel: false, text: "" },
  { parallel: false, text: "Late result" },
  { parallel: true, text: "" },
  { parallel: true, text: "Late result" },
])("cancelled subagents cannot finalize or return late success (%j)", async ({ parallel, text }) => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parent = await Session.create({})
      const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }
      const user = await Session.updateMessage({
        id: MessageID.ascending(),
        sessionID: parent.id,
        role: "user",
        agent: "build",
        model,
        time: { created: Date.now() },
      })
      const assistant = await Session.updateMessage({
        id: MessageID.ascending(),
        sessionID: parent.id,
        role: "assistant",
        parentID: user.id,
        mode: "build",
        agent: "build",
        modelID: model.modelID,
        providerID: model.providerID,
        path: { cwd: tmp.path, root: tmp.path },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() },
      })
      const controller = new AbortController()
      vi.spyOn(SessionPrompt, "cancel").mockResolvedValue(undefined)
      const prompt = vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
        controller.abort()
        return {
          info: { ...assistant, id: input.messageID ?? MessageID.ascending(), sessionID: input.sessionID },
          parts: text ? [{ type: "text", text }] : [],
        } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
      })
      const ctx = {
        sessionID: parent.id,
        messageID: assistant.id,
        agent: "build",
        abort: controller.signal,
        messages: [],
        metadata: () => {},
        ask: async () => {},
      }
      const task = { description: "Inspect source", prompt: "Inspect one source file.", subagent_type: "explore" }
      const execute = parallel
        ? (await TaskParallelTool.init()).execute({ tasks: [task] }, ctx)
        : (await TaskTool.init()).execute(task, ctx)
      await expect(execute).rejects.toMatchObject({ name: "AbortError" })
      expect(prompt).toHaveBeenCalledTimes(1)
      expect(await Session.children(parent.id)).toEqual([])
    },
  })
})
