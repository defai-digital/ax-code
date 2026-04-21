export type RuntimeSyncEvent =
  | { type: "mcp.tools.changed" }
  | { type: "lsp.updated" }
  | { type: "code.index.progress" }
  | { type: "code.index.state" }
  | { type: "vcs.branch.updated"; properties: { branch: string } }

export interface RuntimeSyncEventHandlers {
  syncMcpStatus: () => Promise<void> | void
  syncLspStatus: () => Promise<void> | void
  syncDebugEngine: () => Promise<void> | void
  setVcsBranch: (branch: string) => void
  onWarn: (label: string, error: unknown) => void
}

function syncWithWarning(
  label: string,
  task: () => Promise<void> | void,
  onWarn: (label: string, error: unknown) => void,
) {
  try {
    void Promise.resolve(task()).catch((error) => onWarn(label, error))
  } catch (error) {
    onWarn(label, error)
  }
}

export function handleRuntimeSyncEvent(event: RuntimeSyncEvent, handlers: RuntimeSyncEventHandlers) {
  switch (event.type) {
    case "mcp.tools.changed":
      syncWithWarning("mcp status sync failed", handlers.syncMcpStatus, handlers.onWarn)
      return true

    case "lsp.updated":
      syncWithWarning("lsp status sync failed", handlers.syncLspStatus, handlers.onWarn)
      syncWithWarning("debug engine sync failed", handlers.syncDebugEngine, handlers.onWarn)
      return true

    case "code.index.progress":
    case "code.index.state":
      syncWithWarning("debug engine sync failed", handlers.syncDebugEngine, handlers.onWarn)
      return true

    case "vcs.branch.updated":
      handlers.setVcsBranch(event.properties.branch)
      return true
  }
}
