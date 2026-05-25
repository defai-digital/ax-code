import { Instance } from "../project/instance"
import { MessageV2 } from "./message-v2"
import { MessageID, PartID, SessionID } from "./schema"

type AssistantPath = MessageV2.Assistant["path"]
type AssistantTokens = MessageV2.Assistant["tokens"]

export function textPart(input: {
  messageID: MessageID
  sessionID: SessionID
  text: string
  synthetic?: boolean
  time?: MessageV2.TextPart["time"]
}): MessageV2.TextPart {
  return {
    id: PartID.ascending(),
    messageID: input.messageID,
    sessionID: input.sessionID,
    type: "text",
    text: input.text,
    ...(input.synthetic === undefined ? {} : { synthetic: input.synthetic }),
    ...(input.time === undefined ? {} : { time: input.time }),
  }
}

export function syntheticTextPart(input: {
  messageID: MessageID
  sessionID: SessionID
  text: string
}): MessageV2.TextPart {
  return textPart({ ...input, synthetic: true })
}

export function sessionAssistantPath(input?: { directory?: string; worktree?: string }): AssistantPath {
  return {
    cwd: input?.directory ?? Instance.directory,
    root: input?.worktree ?? Instance.worktree,
  }
}

export function zeroTokenUsage(input?: { total?: number }): AssistantTokens {
  const tokens = {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  }
  if (input?.total === undefined) return tokens
  return {
    total: input.total,
    ...tokens,
  }
}
