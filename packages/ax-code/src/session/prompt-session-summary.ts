import { Log } from "../util/log"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"
import { SessionSummary } from "./summary"

const log = Log.create({ service: "session.prompt" })

export function scheduleFirstTurnSummary(input: {
  sessionID: SessionID
  messageID: MessageV2.User["id"]
  messages: MessageV2.WithParts[]
}) {
  SessionSummary.summarize(
    {
      sessionID: input.sessionID,
      messageID: input.messageID,
    },
    input.messages,
  ).catch(async (error) => {
    log.warn("summarize failed, setting fallback title", {
      command: "session.prompt.summarize",
      status: "error",
      sessionID: input.sessionID,
      error,
    })
    await Session.setTitle({ sessionID: input.sessionID, title: "Untitled session" }).catch((fallbackError) => {
      log.warn("fallback setTitle also failed", { sessionID: input.sessionID, error: fallbackError })
    })
  })
}
