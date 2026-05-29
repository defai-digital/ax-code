import type { DesktopBackendConnection, DesktopBackendManager } from "../lifecycle/backend-manager"

export type DesktopRendererAppConfig = {
  mode: "live"
  baseUrl: string
  headers?: Record<string, string>
  directory?: string
  features: {
    terminalPane: boolean
    browserPane: boolean
    filePane: boolean
  }
  scheduledTaskExecution: {
    owner: "desktop-sidecar" | "attached-backend"
    stopsOnAppQuit: boolean
  }
}

export function createDesktopRendererAppConfig(connection: DesktopBackendConnection): DesktopRendererAppConfig {
  return {
    mode: "live",
    baseUrl: connection.url,
    headers: Object.keys(connection.headers).length > 0 ? { ...connection.headers } : undefined,
    directory: connection.directory,
    features: {
      terminalPane: true,
      browserPane: true,
      filePane: true,
    },
    scheduledTaskExecution:
      connection.mode === "start"
        ? { owner: "desktop-sidecar", stopsOnAppQuit: true }
        : { owner: "attached-backend", stopsOnAppQuit: false },
  }
}

export function getDesktopRendererAppConfig(backend: DesktopBackendManager): DesktopRendererAppConfig {
  const connection = backend.getConnection()
  if (!connection) throw new Error("AX Code backend is not connected")
  return createDesktopRendererAppConfig(connection)
}
