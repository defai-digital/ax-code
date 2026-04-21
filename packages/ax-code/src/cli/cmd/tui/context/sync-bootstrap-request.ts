import type { OpencodeClient } from "@ax-code/sdk/v2"

export interface TimedBootstrapRequest<T> {
  label: string
  request: () => Promise<T>
  timeoutMs?: number
  onSettled?: () => void
}

export type BootstrapRequestWrap = <T>(
  label: string,
  promise: Promise<T>,
  timeoutMs?: number,
) => Promise<T>

export function createTimedBootstrapRequest<T>(
  wrap: BootstrapRequestWrap,
  input: TimedBootstrapRequest<T>,
) {
  return () => {
    const timed = wrap(
      input.label,
      Promise.resolve().then(input.request),
      input.timeoutMs,
    )
    return input.onSettled ? timed.finally(input.onSettled) : timed
  }
}

export function createTimedBootstrapRequests<const T extends Record<string, TimedBootstrapRequest<any>>>(
  wrap: BootstrapRequestWrap,
  requests: T,
): { [K in keyof T]: () => Promise<Awaited<ReturnType<T[K]["request"]>>> } {
  const out = {} as { [K in keyof T]: () => Promise<Awaited<ReturnType<T[K]["request"]>>> }

  for (const key of Object.keys(requests) as Array<keyof T>) {
    out[key] = createTimedBootstrapRequest(wrap, requests[key]) as { [K in keyof T]: () => Promise<Awaited<ReturnType<T[K]["request"]>>> }[typeof key]
  }

  return out
}

export type SyncBootstrapRequestClient = Pick<
  OpencodeClient,
  | "app"
  | "command"
  | "config"
  | "experimental"
  | "formatter"
  | "lsp"
  | "mcp"
  | "path"
  | "permission"
  | "provider"
  | "question"
  | "session"
  | "vcs"
>

export function createSyncBootstrapRequests<TClient extends SyncBootstrapRequestClient>(input: {
  wrap: BootstrapRequestWrap
  client: TClient
  sessionListStart: number
  onSessionListSettled?: () => void
  syncAutonomous: () => Promise<unknown>
  syncDebugEngine: () => Promise<unknown>
  syncIsolation: () => Promise<unknown>
  syncSmartLlm: () => Promise<unknown>
  syncWorkspaces: () => Promise<unknown>
}) {
  return createTimedBootstrapRequests(input.wrap, {
    sessionListPromise: {
      label: "tui bootstrap session.list",
      request: () =>
        input.client.session
          .list({ start: input.sessionListStart })
          .then((response) => (response.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id))),
      onSettled: input.onSessionListSettled,
    },
    providersPromise: {
      label: "tui bootstrap config.providers",
      request: () => input.client.config.providers({}, { throwOnError: true }),
    },
    providerListPromise: {
      label: "tui bootstrap provider.list",
      request: () => input.client.provider.list({}, { throwOnError: true }),
    },
    agentsPromise: {
      label: "tui bootstrap app.agents",
      request: () => input.client.app.agents({}, { throwOnError: true }),
    },
    configPromise: {
      label: "tui bootstrap config.get",
      request: () => input.client.config.get({}, { throwOnError: true }),
    },
    commandPromise: {
      label: "tui bootstrap command.list",
      request: () => input.client.command.list(),
    },
    permissionPromise: {
      label: "tui bootstrap permission.list",
      request: () => input.client.permission.list(),
    },
    questionPromise: {
      label: "tui bootstrap question.list",
      request: () => input.client.question.list(),
    },
    sessionStatusPromise: {
      label: "tui bootstrap session.status",
      request: () => input.client.session.status(),
    },
    providerAuthPromise: {
      label: "tui bootstrap provider.auth",
      request: () => input.client.provider.auth(),
    },
    pathPromise: {
      label: "tui bootstrap path.get",
      request: () => input.client.path.get(),
    },
    isolationTask: {
      label: "tui bootstrap isolation",
      request: () => input.syncIsolation(),
    },
    autonomousTask: {
      label: "tui bootstrap autonomous",
      request: () => input.syncAutonomous(),
    },
    lspPromise: {
      label: "tui bootstrap lsp.status",
      request: () => input.client.lsp.status(),
    },
    mcpPromise: {
      label: "tui bootstrap mcp.status",
      request: () => input.client.mcp.status(),
    },
    resourcePromise: {
      label: "tui bootstrap resource.list",
      request: () => input.client.experimental.resource.list(),
    },
    formatterPromise: {
      label: "tui bootstrap formatter.status",
      request: () => input.client.formatter.status(),
    },
    vcsPromise: {
      label: "tui bootstrap vcs.get",
      request: () => input.client.vcs.get(),
    },
    workspacesTask: {
      label: "tui bootstrap worktree.list",
      request: () => input.syncWorkspaces(),
    },
    debugEngineTask: {
      label: "tui bootstrap debug-engine",
      request: () => input.syncDebugEngine(),
    },
    smartLlmTask: {
      label: "tui bootstrap smart-llm",
      request: () => input.syncSmartLlm(),
    },
  })
}
