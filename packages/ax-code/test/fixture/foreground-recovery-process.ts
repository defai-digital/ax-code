import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionExecution } from "../../src/session/execution"
import { SessionExecutionContext } from "../../src/session/execution-context"
import { SessionExecutionRecovery } from "../../src/session/execution-recovery"
import { SessionRevert } from "../../src/session/revert"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Snapshot } from "../../src/snapshot"

// Seeds transcript fault boundaries, not a real model/tool trajectory.
const [phase, directory, sessionText, previousGeneration, completedText] = process.argv.slice(2)
await Instance.provide({
  directory,
  fn: async () => {
    if (phase === "hold") {
      const session = await Session.create({ title: "Process recovery contract" })
      await SessionExecution.withRun(session.id, async () => {
        const user = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          agent: "build",
          model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
          time: { created: Date.now() },
        })
        const assistant = await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "assistant",
          parentID: user.id,
          agent: "build",
          mode: "build",
          path: { cwd: directory, root: directory },
          modelID: ModelID.make("test"),
          providerID: ProviderID.make("test"),
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now(), ...(completedText === "1" ? { completed: 2 } : {}) },
        })
        const snapshot = await Snapshot.track()
        if (!snapshot) throw new Error("Missing snapshot fault baseline")
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: assistant.id,
          type: "step-start",
          snapshot,
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: assistant.id,
          type: "tool",
          tool: "write",
          callID: "interrupted",
          state: {
            status: "running",
            input: { filePath: "tracked.txt" },
            time: { start: 123 },
            metadata: { output: "partial output" },
          },
        })
        await Session.updatePart({
          id: PartID.ascending(),
          sessionID: session.id,
          messageID: assistant.id,
          type: "text",
          text: "partial text\r\n",
          time: { start: 124 },
        })
        await fs.writeFile(path.join(directory, "tracked.txt"), "after\n")
        process.stdout.write(
          JSON.stringify({
            sessionID: session.id,
            generation: SessionExecutionContext.peek()!.stamp.generation,
            pid: process.pid,
          }) + "\n",
        )
        // An unsettled promise alone does not keep a Node process alive.
        const keepAlive = setInterval(() => {}, 1000)
        try {
          await new Promise(() => {})
        } finally {
          clearInterval(keepAlive)
        }
      })
      return
    }
    const sessionID = SessionID.make(sessionText)
    if (phase === "contend") {
      let busy = false
      try {
        await SessionExecution.withRun(sessionID, async () => {
          throw new Error("Live owner was displaced")
        })
      } catch (error) {
        if (!(error instanceof Session.BusyError)) throw error
        busy = true
      }
      const messages = await Session.messages({ sessionID })
      process.stdout.write(
        JSON.stringify({
          busy,
          messages: messages.map((item) => item.info),
          parts: messages.flatMap((item) => item.parts),
        }) + "\n",
      )
      return
    }
    if (phase !== "recover") throw new Error("Unknown recovery phase")
    let recovered = false
    let userID: MessageID | undefined
    await SessionExecution.withRun(sessionID, async () => {
      const messages = await Session.messages({ sessionID })
      userID = messages.find((item) => item.info.role === "user")!.info.id
      const assistant = messages.find((item) => item.info.role === "assistant")!
      if (
        assistant.info.role !== "assistant" ||
        assistant.info.execution?.generation !== previousGeneration ||
        assistant.info.error?.name !== "MessageAbortedError" ||
        assistant.info.error.data.metadata?.reason !== "backend_restart" ||
        typeof assistant.info.time.completed !== "number"
      )
        throw new Error("Assistant not recovered before admission")
      if (completedText === "1" && assistant.info.time.completed !== 2)
        throw new Error("Original completion time changed")
      const tool = assistant.parts.find((part) => part.type === "tool")
      const text = assistant.parts.find((part) => part.type === "text")
      if (
        tool?.type !== "tool" ||
        tool.state.status !== "error" ||
        tool.state.time.start !== 123 ||
        tool.state.metadata?.["output"] !== "partial output" ||
        tool.state.metadata?.["interruptionReason"] !== "backend_restart"
      )
        throw new Error("Tool evidence lost")
      if (text?.type !== "text" || text.text !== "partial text\r\n" || !text.time?.end)
        throw new Error("Text evidence lost")
      if (assistant.parts.some((part) => part.type === "patch" || part.type === "step-finish"))
        throw new Error("Recovery invented undo coverage")
      if (SessionExecutionRecovery.recover(sessionID, previousGeneration) !== 0)
        throw new Error("Recovery is not idempotent")
      recovered = true
    })
    let undoRejected = false
    try {
      await SessionRevert.preview({ sessionID, messageID: userID! })
    } catch (error) {
      if (!SessionRevert.IncompleteCoverageError.isInstance(error)) throw error
      undoRejected = true
    }
    if (!undoRejected || (await fs.readFile(path.join(directory, "tracked.txt"), "utf8")) !== "after\n")
      throw new Error("Undo failed open")
    process.stdout.write(JSON.stringify({ recovered, undoRejected, source: "seeded_transcript_fault" }) + "\n")
  },
})
await Instance.disposeAll()
