import { AutoIndex } from "../code-intelligence/auto-index"
import { CodeIntelligence } from "../code-intelligence"
import { Instance } from "../project/instance"
import type { ProjectID } from "../project/schema"
import { Log } from "../util/log"
import { Recorder } from "../replay/recorder"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

export function createDeferredCodeGraphAutoIndex(input: { sessionID: SessionID; abort: AbortSignal }) {
  let projectID: ProjectID | undefined
  return {
    set(nextProjectID: ProjectID | undefined) {
      if (nextProjectID) projectID = nextProjectID
    },
    flush() {
      if (!projectID || input.abort.aborted) return
      const deferredProjectID = projectID
      const timer = setTimeout(() => {
        try {
          AutoIndex.maybeStart(deferredProjectID)
        } catch (error) {
          log.warn("deferred auto-index scheduling failed", {
            command: "session.prompt.codeGraph",
            status: "error",
            sessionID: input.sessionID,
            error,
          })
        }
      }, 0)
      timer.unref?.()
    },
  }
}

export function recordCodeGraphSessionStart(input: { sessionID: SessionID; enabled: boolean }): ProjectID | undefined {
  if (!input.enabled) return undefined

  // Defensive: if the code_* tables are missing (e.g. an old DB before v3)
  // or the watcher fails to subscribe, swallow and skip. Code Intelligence
  // should never take down a prompt session.
  try {
    const projectID = Instance.project.id
    const status = CodeIntelligence.status(projectID)
    Recorder.emit({
      type: "code.graph.snapshot",
      sessionID: input.sessionID,
      projectID: status.projectID,
      commitSha: status.lastCommitSha,
      nodeCount: status.nodeCount,
      edgeCount: status.edgeCount,
      lastIndexedAt: status.lastUpdated,
    })
    CodeIntelligence.startWatcher(projectID)
    if (status.nodeCount === 0) {
      try {
        AutoIndex.maybeStart(projectID)
      } catch (error) {
        log.warn("auto-index scheduling failed during code graph init", {
          command: "session.prompt.codeGraph",
          status: "error",
          sessionID: input.sessionID,
          error,
        })
      }
    }
    // Start auto-index from the same reliable path that starts the graph
    // watcher. maybeStart() is fire-and-forget and self-gates; returning
    // the project id allows prompt.ts to schedule a second deferred chance.
    return projectID
  } catch (e) {
    log.warn("code.graph init skipped", {
      command: "session.prompt.codeGraph",
      status: "error",
      errorCode: "GRAPH_INIT_SKIPPED",
      sessionID: input.sessionID,
      e: e instanceof Error ? e.message : String(e),
    })
    return undefined
  }
}
