import type { LSPClient } from "./client"
import type { LSPServer } from "./server"
import { BuiltinServerProfiles } from "./server-profile"

export type ClientMode = "all" | "semantic"

export type ClientOptions = {
  mode?: ClientMode
  method?: LSPServer.Method
  methods?: LSPServer.Method[]
}

export type PrewarmSelectionOptions = {
  maxFiles?: number
  maxLanguages?: number
}

export type ClientSelection = {
  clients: LSPClient.Info[]
  freshSpawnCount: number
}

export type ClientRequest = {
  mode: ClientMode
  methods: LSPServer.Method[]
}

export function resolveClientRequest(opts: ClientOptions): ClientRequest {
  return {
    mode: opts.mode ?? "all",
    methods: requestedMethods(opts),
  }
}

export function clientModeMatchesServer(mode: ClientMode, semantic?: boolean) {
  return mode === "all" || semantic !== false
}

export function clientPrewarmMatchesServer(server: Pick<LSPServer.Info, "id">) {
  return BuiltinServerProfiles[server.id]?.prewarm !== false
}

export function requestedMethods(opts: ClientOptions): LSPServer.Method[] {
  const seen = new Set<LSPServer.Method>()
  const methods: LSPServer.Method[] = []
  if (opts.method && !seen.has(opts.method)) {
    seen.add(opts.method)
    methods.push(opts.method)
  }
  for (const method of opts.methods ?? []) {
    if (seen.has(method)) continue
    seen.add(method)
    methods.push(method)
  }
  return methods
}

export function clientMethodMatchesServer(
  method: LSPServer.Method | LSPServer.Method[] | undefined,
  capabilityHints?: LSPServer.CapabilityHints,
) {
  const methods = Array.isArray(method) ? method : method ? [method] : []
  if (methods.length === 0) return true
  return methods.some((candidate) => capabilityHints?.[candidate] !== false)
}

export function serverMatchesClientRequest(
  server: Pick<LSPServer.Info, "semantic" | "capabilityHints">,
  request: ClientRequest,
) {
  return (
    clientModeMatchesServer(request.mode, server.semantic) &&
    clientMethodMatchesServer(request.methods, server.capabilityHints)
  )
}

export function serverSupportsFileExtension(server: Pick<LSPServer.Info, "extensions">, extension: string) {
  return server.extensions.length === 0 || server.extensions.includes(extension)
}

export function sortClients(clients: LSPClient.Info[]): LSPClient.Info[] {
  return [...clients].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority
    return a.serverID.localeCompare(b.serverID)
  })
}

export function filterClientsForMethod(
  clients: LSPClient.Info[],
  method: LSPServer.Method | undefined,
): LSPClient.Info[] {
  if (!method) return sortClients(clients)

  const supported = clients.filter((client) => client.methodSupport(method) === "supported")
  if (supported.length > 0) return sortClients(supported)

  const maybeSupported = clients.filter((client) => client.methodSupport(method) !== "unsupported")
  if (maybeSupported.length > 0) return sortClients(maybeSupported)

  return sortClients(clients)
}

export function filterClientsForMethods(clients: LSPClient.Info[], methods: LSPServer.Method[]): LSPClient.Info[] {
  if (methods.length === 0) return sortClients(clients)

  return [...clients].sort((a, b) => {
    const aSupported = methods.filter((method) => a.methodSupport(method) === "supported").length
    const bSupported = methods.filter((method) => b.methodSupport(method) === "supported").length
    if (aSupported !== bSupported) return bSupported - aSupported

    const aMaybe = methods.filter((method) => a.methodSupport(method) !== "unsupported").length
    const bMaybe = methods.filter((method) => b.methodSupport(method) !== "unsupported").length
    if (aMaybe !== bMaybe) return bMaybe - aMaybe

    if (a.priority !== b.priority) return b.priority - a.priority
    return a.serverID.localeCompare(b.serverID)
  })
}

export function filterClientsForSelection(clients: LSPClient.Info[], opts: ClientOptions): LSPClient.Info[] {
  if (opts.method) return filterClientsForMethod(clients, opts.method)

  const methods = requestedMethods(opts)
  if (methods.length > 0) return filterClientsForMethods(clients, methods)

  return sortClients(clients)
}
