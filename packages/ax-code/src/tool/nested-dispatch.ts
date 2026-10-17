import type { Tool } from "./tool"
import type { MessageV2 } from "../session/message-v2"
import { Env } from "@/util/env"
import type { PartID } from "../session/schema"
import { toErrorMessage } from "@/util/error-message"

const activeParts = new Map<string, MessageV2.ToolPart>()
export function nestedToolPart(callID: string) {
  return activeParts.get(callID)
}

/** The parent owns its session lane; safe reads share a pool, every other call is a barrier. */
export function createToolBarrier(dispatcher: Pick<Tool.Dispatcher, "concurrencySafe">) {
  let barrier: Promise<unknown> = Promise.resolve()
  let reads: Promise<unknown>[] = []
  return <T>(call: { tool: string; parameters: unknown }, run: () => Promise<T>): Promise<T> => {
    let safe = false
    try {
      safe = dispatcher.concurrencySafe?.(call) === true
    } catch {
      /* An uncertain call is exclusive. */
    }
    const result = (safe ? barrier : Promise.allSettled([barrier, ...reads])).then(run)
    // Failed operations remain observable to their caller, without poisoning later work.
    const settled = result.then(
      () => {},
      () => {},
    )
    if (safe) reads.push(settled)
    else {
      reads = []
      barrier = settled
    }
    return result
  }
}

/** Same ordinary tool-part lifecycle for Batch and Code Mode; imports stay lazy. */
export async function dispatchToolPart(input: {
  ctx: Tool.Context
  tool: string
  parameters: unknown
  partID?: PartID
  run(callID: PartID): Promise<Tool.InvocationResult>
}): Promise<Tool.InvocationResult> {
  const { Session } = await import("../session")
  const { PartID } = await import("../session/schema")
  const id = input.partID ?? PartID.ascending()
  const start = Date.now()
  const base = {
    id,
    messageID: input.ctx.messageID,
    sessionID: input.ctx.sessionID,
    type: "tool" as const,
    tool: input.tool,
    callID: id,
  }
  const { SessionProcessor } = await import("../session/processor")
  const parameters = SessionProcessor.redactPersistedToolInput(input.tool, input.parameters as Record<string, unknown>)
  const part: MessageV2.ToolPart = { ...base, state: { status: "running", input: parameters, time: { start } } }
  await Session.updatePart(part)
  activeParts.set(id, part)
  try {
    input.ctx.abort.throwIfAborted()
    const result = await input.run(id)
    await Session.updatePart({
      ...base,
      state: {
        status: "completed",
        input: parameters,
        output: result.output,
        title: result.title,
        metadata: { ...(part.state.status === "running" ? part.state.metadata : {}), ...result.metadata },
        attachments: result.attachments,
        time: { start, end: Date.now() },
      },
    })
    return result
  } catch (error) {
    await Session.updatePart({
      ...base,
      state: {
        status: "error",
        input: parameters,
        error: Env.redactForRecord(toErrorMessage(error)),
        metadata: part.state.status === "running" ? part.state.metadata : undefined,
        time: { start, end: Date.now() },
      },
    })
    throw error
  } finally {
    activeParts.delete(id)
  }
}
