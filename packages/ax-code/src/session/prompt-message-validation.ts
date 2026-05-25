import { Log } from "../util/log"
import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

export function validateUserMessageForSave(input: {
  sessionID: SessionID
  info: MessageV2.User
  parts: MessageV2.Part[]
}) {
  const parsedInfo = MessageV2.Info.safeParse(input.info)
  if (!parsedInfo.success) {
    log.error("invalid user message before save", {
      command: "session.prompt.validate",
      status: "error",
      errorCode: "INVALID_MESSAGE",
      sessionID: input.sessionID,
      messageID: input.info.id,
      agent: input.info.agent,
      model: input.info.model,
      issues: parsedInfo.error.issues,
    })
    throw new Error(
      `Invalid user message: ${parsedInfo.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    )
  }

  const invalidParts: number[] = []
  input.parts.forEach((part, index) => {
    const parsedPart = MessageV2.Part.safeParse(part)
    if (parsedPart.success) return
    log.error("invalid user part before save", {
      command: "session.prompt.validate",
      status: "error",
      errorCode: "INVALID_PART",
      sessionID: input.sessionID,
      messageID: input.info.id,
      partID: part.id,
      partType: part.type,
      index,
      issues: parsedPart.error.issues,
      part,
    })
    invalidParts.push(index)
  })
  if (invalidParts.length > 0) {
    throw new Error(`Invalid user part(s) at index ${invalidParts.join(", ")} — see log for details`)
  }
}
