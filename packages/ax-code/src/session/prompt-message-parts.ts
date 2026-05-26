import { NamedError } from "@ax-code/util/error"
import { Permission } from "../permission"
import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"
import { PartID, type MessageID, type SessionID } from "./schema"
import { resolveFileAttachmentPart } from "./prompt-file-attachment"
import { resolveMcpResourcePart } from "./prompt-mcp-resource"
import type { PromptPartInput } from "./prompt-part-input"

const log = Log.create({ service: "session.prompt" })

type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
type DraftTextPart = Draft<MessageV2.TextPart>
type DraftPart = Draft<MessageV2.Part>

function assignPartID(part: DraftPart): MessageV2.Part {
  return {
    ...part,
    id: part.id ? PartID.make(part.id) : PartID.ascending(),
  }
}

function agentInstructionPart(input: {
  part: Extract<PromptPartInput, { type: "agent" }>
  agentPermission: Permission.Ruleset
  attachDraftContext: <T extends object>(part: T) => T & { messageID: MessageID; sessionID: SessionID }
  draftSyntheticTextPart: (text: string) => DraftTextPart
}): DraftPart[] {
  const perm = Permission.evaluate("task", input.part.name, input.agentPermission)
  const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
  return [
    input.attachDraftContext(input.part),
    // An extra space is added here. Otherwise the "Use" gets appended
    // to the user's last word, creating a combined word.
    input.draftSyntheticTextPart(
      " Use the above message and context to generate a prompt and call the task tool with subagent: " +
        input.part.name +
        hint,
    ),
  ]
}

export async function resolveUserMessageParts(input: {
  sessionID: SessionID
  messageID: MessageID
  agentName: string
  agentPermission: Permission.Ruleset
  parts: PromptPartInput[]
}): Promise<MessageV2.Part[]> {
  const draftSyntheticTextPart = (text: string): DraftTextPart => ({
    messageID: input.messageID,
    sessionID: input.sessionID,
    type: "text",
    synthetic: true,
    text,
  })
  const attachDraftContext = <T extends object>(part: T): T & { messageID: MessageID; sessionID: SessionID } => ({
    ...part,
    messageID: input.messageID,
    sessionID: input.sessionID,
  })

  const resolvedParts = await Promise.allSettled(
    input.parts.map(async (part): Promise<DraftPart[]> => {
      if (part.type === "file") {
        if (part.source?.type === "resource") {
          return resolveMcpResourcePart({
            sessionID: input.sessionID,
            agentName: input.agentName,
            agentPermission: input.agentPermission,
            part: { ...part, source: part.source },
            draftSyntheticTextPart,
            attachDraftContext,
          })
        }
        return resolveFileAttachmentPart({
          sessionID: input.sessionID,
          messageID: input.messageID,
          agentName: input.agentName,
          part,
          draftSyntheticTextPart,
          attachDraftContext,
        })
      }

      if (part.type === "agent") {
        return agentInstructionPart({
          part,
          agentPermission: input.agentPermission,
          attachDraftContext,
          draftSyntheticTextPart,
        })
      }

      return [attachDraftContext(part)]
    }),
  )

  return resolvedParts
    .flatMap((result): DraftPart[] => {
      if (result.status === "fulfilled") return result.value
      const message = NamedError.message(result.reason)
      log.warn("failed to resolve user message part", {
        command: "session.prompt.resolvePart",
        status: "error",
        errorCode: "PART_RESOLVE",
        sessionID: input.sessionID,
        error: result.reason,
      })
      return [draftSyntheticTextPart(`Failed to resolve attachment: ${message}`)]
    })
    .map(assignPartID)
}
