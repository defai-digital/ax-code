import { Instance } from "@/project/instance"
import { ModelID, ProviderID } from "@/provider/schema"
import { NotFoundError } from "@/storage/db"
import { Session } from "."
import { SessionExecutionContext } from "./execution-context"
import { MessageV2 } from "./message-v2"
import { SessionPrompt } from "./prompt"
import type { MessageID } from "./schema"
import type { TaskQueue } from "./task-queue"

export type BackgroundSubagentRecipient = Pick<Session.Info, "id" | "directory" | "projectID">

function assertRecipientProject(recipient: BackgroundSubagentRecipient): void {
  if (Instance.project.id !== recipient.projectID) {
    throw new Error("Background message workspace no longer belongs to the recipient project.")
  }
}

function queueModel(model: unknown): MessageV2.User["model"] {
  if (
    model &&
    typeof model === "object" &&
    "providerID" in model &&
    "modelID" in model &&
    typeof model.providerID === "string" &&
    typeof model.modelID === "string"
  ) {
    return { providerID: ProviderID.make(model.providerID), modelID: ModelID.make(model.modelID) }
  }
  return { providerID: ProviderID.make("unknown"), modelID: ModelID.make("unknown") }
}

export async function writeBackgroundSubagentMessage(input: {
  recipient: BackgroundSubagentRecipient
  messageID: MessageID
  part: Pick<MessageV2.TextPart, "id" | "text" | "synthetic" | "metadata">
  item: Pick<TaskQueue.Info, "agent" | "model">
  afterCommit?(message: MessageV2.User): void
}): Promise<void> {
  const { recipient, messageID, item } = input
  const write = async () => {
    assertRecipientProject(recipient)
    const sessionID = recipient.id
    const existing = await MessageV2.get({ sessionID, messageID }).catch((error: unknown) => {
      if (NotFoundError.isInstance(error)) return undefined
      throw error
    })
    const previous = existing?.info.role === "user" ? existing.info : undefined
    const latest = previous
      ? undefined
      : (await Session.messages({ sessionID })).findLast(
          (message) => message.info.role === "user" && !message.parts.some((part) => part.type === "compaction"),
        )?.info
    const source = previous ?? (latest?.role === "user" ? latest : undefined)
    // Reuse the ledger's message id and original send time on retry.
    const message: MessageV2.User = {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: previous?.time.created ?? Date.now() },
      agent: source?.agent ?? item.agent ?? "build",
      model: source?.model ?? queueModel(item.model),
      tools: source?.tools,
      isolation: source?.isolation,
      system: source?.system,
      format: source?.format,
      variant: source?.variant,
      requestedDepth: source?.requestedDepth,
    }
    const part: MessageV2.TextPart = { ...input.part, type: "text", messageID, sessionID }
    await Session.updateMessageWithParts(message, [part], {
      afterCommit: () => input.afterCommit?.(message),
    })
    return true
  }

  // Use the recipient's journal and active loop when loaded. For a cold
  // recipient, the same project shard can persist the message without booting.
  if (recipient.directory !== Instance.directory && (await Instance.withExisting(recipient.directory, write))) return
  await write()
}

export async function wakeBackgroundSubagentSession(
  recipient: BackgroundSubagentRecipient,
  shouldWake: () => Promise<boolean>,
): Promise<void> {
  await runInBackgroundSubagentSession(recipient, async () => {
    if (await shouldWake()) await SessionPrompt.loop({ sessionID: recipient.id })
  })
}

export async function runInBackgroundSubagentSession(
  recipient: BackgroundSubagentRecipient,
  run: () => Promise<void>,
): Promise<void> {
  await SessionExecutionContext.detached(() =>
    Instance.provide({
      directory: recipient.directory,
      fn: async () => {
        assertRecipientProject(recipient)
        await run()
      },
    }),
  )
}
