import { RequestError, type McpServer } from "@agentclientprotocol/sdk"
import type { ACPSessionState } from "./types"
import { Log } from "@/util/log"
import type { OpencodeClient } from "@ax-code/sdk/v2"

const log = Log.create({ service: "acp-session-manager" })

export class ACPSessionManager {
  private sessions = new Map<string, ACPSessionState>()
  private sdk: OpencodeClient
  // Backstop cap to bound long-running ACP servers. The ACP protocol has
  // no `session.close` notification today, so without this the map grows
  // monotonically as the client creates / loads / forks / resumes
  // sessions across the agent's lifetime. Eviction is insertion-order
  // LRU on `create` / `load` / `track` (the same paths that grow the
  // map), so the oldest unused state is dropped first. 1024 is well
  // above any realistic concurrent-session count for a single ACP
  // connection while keeping memory bounded.
  private static readonly MAX_SESSIONS = 1024

  constructor(sdk: OpencodeClient) {
    this.sdk = sdk
  }

  private track(sessionId: string, state: ACPSessionState) {
    // Re-insert to MRU position — Map iteration order is insertion
    // order, so deleting first guarantees the just-set entry sits at
    // the tail.
    this.sessions.delete(sessionId)
    this.sessions.set(sessionId, state)
    while (this.sessions.size > ACPSessionManager.MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value
      if (oldest === undefined || oldest === sessionId) break
      this.sessions.delete(oldest)
      log.warn("evicting oldest acp session — likely indicates leaked sessions", {
        evictedSessionId: oldest,
        cap: ACPSessionManager.MAX_SESSIONS,
      })
    }
  }

  /**
   * Drop a session's state. Call when the ACP client signals end of a
   * session, or from connection-teardown paths so we don't leak state
   * for sessions the client will never reuse.
   */
  remove(sessionId: string) {
    this.sessions.delete(sessionId)
  }

  /** Drop all session state — used on full agent disposal. */
  clear() {
    this.sessions.clear()
  }

  tryGet(sessionId: string): ACPSessionState | undefined {
    return this.sessions.get(sessionId)
  }

  async create(cwd: string, mcpServers: McpServer[], model?: ACPSessionState["model"]): Promise<ACPSessionState> {
    const session = await this.sdk.session
      .create(
        {
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((x) => {
        if (!x.data) throw new Error("session.create returned empty data")
        return x.data
      })

    const sessionId = session.id
    const resolvedModel = model

    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      createdAt: new Date(),
      model: resolvedModel,
    }
    log.info("creating_session", { state })

    this.track(sessionId, state)
    return state
  }

  async load(
    sessionId: string,
    cwd: string,
    mcpServers: McpServer[],
    model?: ACPSessionState["model"],
  ): Promise<ACPSessionState> {
    const session = await this.sdk.session
      .get(
        {
          sessionID: sessionId,
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((x) => {
        if (!x.data) throw new Error("session.get returned empty data")
        return x.data
      })

    const resolvedModel = model

    const state: ACPSessionState = {
      id: sessionId,
      cwd,
      mcpServers,
      createdAt: new Date(session.time.created),
      model: resolvedModel,
    }
    log.info("loading_session", { state })

    this.track(sessionId, state)
    return state
  }

  get(sessionId: string): ACPSessionState {
    const session = this.sessions.get(sessionId)
    if (!session) {
      log.error("session not found", { sessionId })
      throw RequestError.invalidParams(JSON.stringify({ error: `Session not found: ${sessionId}` }))
    }
    return session
  }

  getModel(sessionId: string) {
    const session = this.get(sessionId)
    return session.model
  }

  setModel(sessionId: string, model: ACPSessionState["model"]) {
    const session = this.get(sessionId)
    session.model = model
    this.sessions.set(sessionId, session)
    return session
  }

  getVariant(sessionId: string) {
    const session = this.get(sessionId)
    return session.variant
  }

  setVariant(sessionId: string, variant?: string) {
    const session = this.get(sessionId)
    session.variant = variant
    this.sessions.set(sessionId, session)
    return session
  }

  setMode(sessionId: string, modeId: string) {
    const session = this.get(sessionId)
    session.modeId = modeId
    this.sessions.set(sessionId, session)
    return session
  }
}
