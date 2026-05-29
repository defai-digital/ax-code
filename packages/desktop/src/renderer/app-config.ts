import type { DesktopBackendConnection, DesktopBackendManager } from "../lifecycle/backend-manager"

export type DesktopRendererAppConfig = {
  mode: "live"
  baseUrl: string
  headers?: Record<string, string>
  directory?: string
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
