import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionExecutionContext } from "../../src/session/execution-context"
import { ForegroundOwnership } from "../../src/session/foreground-ownership"
import { TaskQueue } from "../../src/session/task-queue"
import { Database } from "../../src/storage/db"
import { LLM } from "../../src/session/llm"
import { Provider } from "../../src/provider/provider"
import { SessionSummary } from "../../src/session/summary"
import { Command } from "../../src/command"
import { Process } from "../../src/util/process"
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

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

function reply(text: string, before?: () => Promise<void>) {
  return {
    fullStream: (async function* () {
      yield { type: "start" }
      yield { type: "start-step" }
      yield { type: "text-start", id: "reply" }
      if (before) await before()
      yield { type: "text-delta", id: "reply", text }
      yield { type: "text-end", id: "reply" }
      yield { type: "finish-step", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }
      yield { type: "finish" }
    })(),
    // This processor fixture supplies the event stream it consumes; provider
    // response convenience accessors are deliberately absent.
  } as unknown as Awaited<ReturnType<typeof LLM.stream>>
}

function prepare() {
  vi.spyOn(Provider, "getModel").mockResolvedValue(model)
  vi.spyOn(SessionSummary, "summarize").mockResolvedValue()
}

test("command templates acquire ownership before shell expansion or user insertion", async () => {
  await using tmp = await tmpdir({ git: true })
  prepare()
  vi.spyOn(Command, "get").mockResolvedValue({ name: "probe", template: "Inspect !`echo probe`", hints: [] })
  const originalText = Process.text
  const expand = vi.fn(() => {
    expect(SessionExecutionContext.peek()?.stamp.generation).toBeDefined()
    expect(() => ForegroundOwnership.acquire(Database.Path, sessionID)).toThrow(ForegroundOwnership.BusyError)
  })
  vi.spyOn(Process, "text").mockImplementation(async (cmd, options) => {
    if (!cmd.includes("echo probe")) return originalText(cmd, options)
    expand()
    return { text: "probe", code: 0, stdout: Buffer.from("probe"), stderr: Buffer.alloc(0) }
  })
  vi.spyOn(LLM, "stream").mockResolvedValue(reply("Command completed."))
  let sessionID: Awaited<ReturnType<typeof Session.create>>["id"]
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Command ownership" })
      sessionID = session.id
      const owner = ForegroundOwnership.acquire(Database.Path, session.id)
      owner.begin()
      const input = { sessionID: session.id, command: "probe", arguments: "", model: "test/test-model", agent: "build" }
      try {
        await expect(SessionPrompt.command(input)).rejects.toThrow(Session.BusyError)
        expect(expand).not.toHaveBeenCalled()
        expect(await Session.messages({ sessionID: session.id })).toEqual([])
      } finally {
        owner.release(true)
      }
      const result = await SessionPrompt.command(input)
      expect(expand).toHaveBeenCalledOnce()
      expect(result.info.role === "assistant" && result.info.execution?.generation).toBeDefined()
    },
  })
})

test("durable follow-up transfers ownership across the queue timer until its prompt completes", async () => {
  await using tmp = await tmpdir({ git: true })
  prepare()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ title: "Execution handoff" })
      const entered = Promise.withResolvers<void>()
      const continueSecond = Promise.withResolvers<void>()
      const generations: string[] = []
      let item: TaskQueue.Info | undefined
      vi.spyOn(LLM, "stream").mockImplementation(async () => {
        generations.push(SessionExecutionContext.peek()!.stamp.generation)
        if (generations.length === 1) {
          item = await TaskQueue.enqueue({
            sessionID: session.id,
            kind: "followup",
            title: "Second turn",
            agent: "build",
            model: { providerID: model.providerID, modelID: model.id },
            payload: { text: "Answer the queued correction." },
          })
          return reply("First completed answer.")
        }
        return reply("Queued correction answered.", async () => {
          entered.resolve()
          await continueSecond.promise
        })
      })
      const first = await SessionPrompt.prompt({
        sessionID: session.id,
        agent: "build",
        model: { providerID: model.providerID, modelID: model.id },
        parts: [{ type: "text", text: "First request" }],
      })
      expect(first.parts.some((part) => part.type === "text" && part.text === "First completed answer.")).toBe(true)
      try {
        await vi.waitFor(() => expect(generations).toHaveLength(2), { timeout: 2000 })
      } catch (error) {
        throw new Error(JSON.stringify({ generations, item: await TaskQueue.get(item!.id), message: String(error) }))
      }
      await entered.promise
      try {
        expect(() => ForegroundOwnership.acquire(Database.Path, session.id)).toThrow(ForegroundOwnership.BusyError)
        expect(generations).toHaveLength(2)
        expect(generations[1]).toBe(generations[0])
      } finally {
        continueSecond.resolve()
      }
      await vi.waitFor(async () => expect((await TaskQueue.get(item!.id)).status).toBe("completed"), {
        timeout: 10_000,
      })
      const messages = await Session.messages({ sessionID: session.id })
      const assistants = messages.filter((message) => message.info.role === "assistant")
      expect(assistants).toHaveLength(2)
      expect(
        assistants.every(
          (message) =>
            message.info.role === "assistant" &&
            message.info.execution?.generation === generations[0] &&
            message.info.time.completed,
        ),
      ).toBe(true)
      expect(messages.filter((message) => message.info.role === "user")).toHaveLength(2)
      await vi.waitFor(async () =>
        expect(
          await fs.access(ForegroundOwnership.paths(Database.Path, session.id).journal).then(
            () => true,
            () => false,
          ),
        ).toBe(false),
      )
    },
  })
})

test.skipIf(process.platform === "win32")(
  "shell-to-prompt callback starts a new authorized turn without releasing the guard",
  async () => {
    vi.stubEnv("SHELL", "/bin/sh")
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(
      path.join(tmp.path, "shell-handoff.cjs"),
      "const fs=require('node:fs');fs.writeFileSync('shell-start','started');setInterval(()=>{if(fs.existsSync('shell-release'))process.exit(0)},10);setTimeout(()=>process.exit(99),10000)\n",
    )
    prepare()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Execution handoff" })
        const entered = Promise.withResolvers<void>()
        const continuePrompt = Promise.withResolvers<void>()
        let promptGeneration: string | undefined
        vi.spyOn(LLM, "stream").mockImplementation(async () => {
          promptGeneration = SessionExecutionContext.peek()!.stamp.generation
          return reply("After-shell instruction answered.", async () => {
            entered.resolve()
            await continuePrompt.promise
          })
        })
        const shell = SessionPrompt.shell({
          sessionID: session.id,
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          command: `"${process.execPath}" shell-handoff.cjs`,
        })
        try {
          await vi.waitFor(
            async () =>
              expect(
                await fs.access(path.join(tmp.path, "shell-start")).then(
                  () => true,
                  () => false,
                ),
              ).toBe(true),
            { timeout: 5000 },
          )
        } catch (error) {
          const tool = (await Session.messages({ sessionID: session.id }))
            .flatMap((message) => message.parts)
            .find((part) => part.type === "tool" && part.tool === "bash")
          throw new Error(`Shell did not create its startup marker. Tool part: ${JSON.stringify(tool)}`, {
            cause: error,
          })
        }
        const prompt = SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
          parts: [{ type: "text", text: "Answer after the shell task." }],
        })
        await vi.waitFor(async () =>
          expect(
            (await Session.messages({ sessionID: session.id })).filter((message) => message.info.role === "user"),
          ).toHaveLength(2),
        )
        await fs.writeFile(path.join(tmp.path, "shell-release"), "release")
        await shell
        await entered.promise
        try {
          expect(() => ForegroundOwnership.acquire(Database.Path, session.id)).toThrow(ForegroundOwnership.BusyError)
          const messages = await Session.messages({ sessionID: session.id })
          const shellAssistant = messages.find((message) =>
            message.parts.some((part) => part.type === "tool" && part.tool === "bash"),
          )!
          expect(shellAssistant.info.role === "assistant" && shellAssistant.info.execution?.generation).toBe(
            promptGeneration,
          )
        } finally {
          continuePrompt.resolve()
        }
        const result = await prompt
        expect(
          result.parts.some((part) => part.type === "text" && part.text === "After-shell instruction answered."),
        ).toBe(true)
        await vi.waitFor(async () =>
          expect(
            await fs.access(ForegroundOwnership.paths(Database.Path, session.id).journal).then(
              () => true,
              () => false,
            ),
          ).toBe(false),
        )
      },
    })
  },
)
