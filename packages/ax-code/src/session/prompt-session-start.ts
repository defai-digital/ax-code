import { Flag } from "../flag/flag"
import { Instance } from "../project/instance"
import { providerModelKey } from "../provider/model-key"
import type { ProjectID } from "../project/schema"
import { Recorder } from "../replay/recorder"
import { Log } from "../util/log"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { recordCodeGraphSessionStart } from "./prompt-code-graph"
import { ensureTitle } from "./prompt-title"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

export function recordPromptSessionStart(input: {
  sessionID: SessionID
  session: Session.Info
  lastUser: MessageV2.User
  messages: MessageV2.WithParts[]
  abort: AbortSignal
  isResumingActiveLoop: boolean
}): ProjectID | undefined {
  ensureTitle({
    session: input.session,
    modelID: input.lastUser.model.modelID,
    providerID: input.lastUser.model.providerID,
    history: input.messages,
    abort: input.abort,
  }).catch((error) => {
    log.debug("failed to ensure title", { sessionID: input.sessionID, error })
  })

  if (!input.isResumingActiveLoop) {
    Recorder.emit({
      type: "session.start",
      sessionID: input.sessionID,
      agent: input.lastUser.agent,
      model: providerModelKey(input.lastUser.model),
      directory: Instance.directory,
    })
  }

  return recordCodeGraphSessionStart({
    sessionID: input.sessionID,
    enabled: !input.isResumingActiveLoop && Flag.AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE,
  })
}
