import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID } from "../../src/session/schema"
import { TaskTool } from "../../src/tool/task"
import { TaskParallelTool } from "../../src/tool/task_parallel"
import { tmpdir } from "../fixture/fixture"

afterEach(() => vi.restoreAllMocks())

test.each([false, true])("child admission retains parent session denials (parallel: %s)", async (parallel) => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      provider: { openai: { options: { apiKey: "test-key" } } },
      experimental: { primary_tools: ["webfetch"] },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const denied = { permission: "bash", pattern: "*", action: "deny" as const }
      const parent = await Session.create({
        permission: [denied, { permission: "edit", pattern: "*", action: "allow" }],
      })
      const model = { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.4") }
      const user = await SessionPrompt.prompt({
        sessionID: parent.id,
        agent: "build",
        model,
        noReply: true,
        parts: [{ type: "text", text: "Inspect the source." }],
      })
      const assistant = await Session.updateMessage({
        id: MessageID.ascending(),
        sessionID: parent.id,
        role: "assistant",
        parentID: user.info.id,
        mode: "build",
        agent: "build",
        modelID: model.modelID,
        providerID: model.providerID,
        path: { cwd: tmp.path, root: tmp.path },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() },
      })
      const originalPrompt = SessionPrompt.prompt
      vi.spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
        // Exercise real prompt admission and its legacy tools-to-permission update,
        // without starting a model call.
        const admitted = await originalPrompt({ ...input, noReply: true })
        const child = await Session.get(input.sessionID)
        expect(Permission.evaluate("bash", "printf unsafe", child.permission ?? []).action).toBe("deny")
        expect(child.permission).not.toContainEqual({ permission: "edit", pattern: "*", action: "allow" })
        return admitted
      })
      const ctx = {
        sessionID: parent.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: () => {},
        ask: async () => {},
      }
      const task = { description: "Inspect source", prompt: "Inspect the source.", subagent_type: "explore" }
      const result = parallel
        ? await (await TaskParallelTool.init()).execute({ tasks: [task] }, ctx)
        : await (await TaskTool.init()).execute(task, ctx)
      // Tool failures are returned as resumable results, so also inspect the
      // durable child after the tool has handled the mocked admission failure.
      const children = await Session.children(parent.id)
      expect(children).toHaveLength(1)
      expect(Permission.evaluate("bash", "printf unsafe", children[0]!.permission ?? []).action).toBe("deny")
      expect(Permission.evaluate("webfetch", "https://example.test", children[0]!.permission ?? []).action).toBe("deny")
      expect(result.output).not.toContain("AssertionError")
      if (!parallel) {
        await Session.setPermission({
          sessionID: children[0]!.id,
          permission: [...(children[0]!.permission ?? []), { permission: "read", pattern: "*", action: "allow" }],
        })
        const laterDenial = { permission: "read", pattern: "*secret*", action: "deny" as const }
        await Session.setPermission({ sessionID: parent.id, permission: [denied, laterDenial] })
        const tool = await TaskTool.init()
        for (let attempt = 0; attempt < 2; attempt++) {
          await tool.execute({ ...task, task_id: children[0]!.id }, ctx)
          const resumed = await Session.get(children[0]!.id)
          expect(Permission.evaluate("read", "secret.txt", resumed.permission ?? []).action).toBe("deny")
          expect(
            resumed.permission?.filter((rule) => rule.permission === "read" && rule.pattern === "*secret*"),
          ).toHaveLength(1)
        }
        expect(await Session.children(parent.id)).toHaveLength(1)
      }
    },
  })
})
