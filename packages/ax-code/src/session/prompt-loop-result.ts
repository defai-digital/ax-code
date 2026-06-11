import { Log } from "../util/log"
import { SessionCompaction } from "./compaction"
import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type PromptLoopResultDeps = {
  prune: typeof SessionCompaction.prune
  stream: typeof MessageV2.stream
}

// Resolve lazily via getters: this module sits on an import cycle with
// compaction.ts, so when a consumer loads compaction first (e.g. running
// compaction tests standalone), the SessionCompaction namespace object is
// still undefined while this module's top level evaluates. Reading the
// properties eagerly here threw "undefined is not an object" at load time.
const defaultDeps: PromptLoopResultDeps = {
  get prune() {
    return SessionCompaction.prune
  },
  get stream() {
    return MessageV2.stream
  },
}

export async function resolvePromptLoopResult(
  input: {
    sessionID: SessionID
    abort: AbortSignal
    shiftQueuedCallback: (sessionID: SessionID) => { resolve: (message: MessageV2.WithParts) => void } | undefined
  },
  deps: PromptLoopResultDeps = defaultDeps,
): Promise<MessageV2.WithParts> {
  deps.prune({ sessionID: input.sessionID }).catch((error) =>
    log.warn("prune failed", {
      command: "session.prompt.prune",
      status: "error",
      sessionID: input.sessionID,
      error,
    }),
  )

  for await (const item of deps.stream(input.sessionID)) {
    if (item.info.role === "user") continue
    input.shiftQueuedCallback(input.sessionID)?.resolve(item)
    return item
  }
  if (input.abort.aborted) throw new DOMException("Aborted", "AbortError")
  throw new Error("Impossible")
}
