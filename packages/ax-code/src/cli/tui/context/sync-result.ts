import { findByID, findWorkspace, sessionRuntimeStatus } from "./sync-query"

export interface SyncResultStoreState<
  TSession extends { id: string } = { id: string },
  TMessage extends { role?: string; time?: object | undefined } = { role?: string; time?: object | undefined },
  TRisk = unknown,
> {
  status: "loading" | "partial" | "complete"
  session: TSession[]
  session_risk: Record<string, TRisk>
  message: Record<string, TMessage[]>
  workspaceList: string[]
}

export function createSyncContextValue<
  TStore extends SyncResultStoreState<any, any>,
  TSet,
  TSessionSync extends (sessionID: string, options?: { force?: boolean; missing?: "ignore" | "throw" }) => unknown,
  TWorkspaceSync extends () => unknown,
  TBootstrap extends () => unknown,
  TRuntime extends object,
>(input: {
  store: TStore
  setStore: TSet
  sessionSync: TSessionSync
  /** Drop fullSynced/in-flight marks so the next sync reloads heavy state (leave prune). */
  sessionClear?: (sessionID: string) => void
  workspaceSync: TWorkspaceSync
  bootstrap: TBootstrap
  runtime: TRuntime
}) {
  type Session = TStore["session"][number]
  type Message = TStore["message"][string] extends Array<infer TItem> ? TItem : never
  type Risk = TStore["session_risk"][string]

  const getSession = (sessionID: string): Session | undefined =>
    findByID(input.store.session, sessionID) as Session | undefined

  return {
    data: input.store,
    set: input.setStore,
    get status() {
      return input.store.status
    },
    get ready() {
      return input.store.status !== "loading"
    },
    session: {
      get: getSession,
      risk(sessionID: string): Risk | undefined {
        return input.store.session_risk[sessionID] as Risk | undefined
      },
      status(sessionID: string) {
        return sessionRuntimeStatus(
          getSession(sessionID) as (Session & { time?: { compacting?: unknown } | undefined }) | undefined,
          (input.store.message[sessionID] ?? []) as Array<Message & { role?: string; time?: object | undefined }>,
        )
      },
      sync: input.sessionSync,
      clear(sessionID: string) {
        input.sessionClear?.(sessionID)
      },
    },
    workspace: {
      get(workspaceID: string) {
        return findWorkspace(input.store.workspaceList, workspaceID)
      },
      sync: input.workspaceSync,
    },
    runtime: input.runtime,
    bootstrap: input.bootstrap,
  }
}
