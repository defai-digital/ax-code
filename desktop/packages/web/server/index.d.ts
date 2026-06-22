import type { Express } from "express"
import type { Server } from "http"

export interface WebUiServerController {
  expressApp: Express
  httpServer: Server
  getPort: () => number | null
  getAxCodePort: () => number | null
  getStartupDiagnostics: () => unknown
  recordDesktopStartupEvent: (event: {
    name: string
    source?: string
    atEpochMs?: number
    details?: Record<string, unknown>
  }) => unknown
  isReady: () => boolean
  restartAxCode: () => Promise<void>
  stop: (options?: { exitProcess?: boolean }) => Promise<void>
}

export interface StartWebUiServerOptions {
  port?: number
  host?: string
  attachSignals?: boolean
  exitOnShutdown?: boolean
  uiPassword?: string | null
  startupDiagnosticsSnapshot?: unknown
  onStartupDiagnostic?: (event: unknown) => void
}

export declare function startWebUiServer(options?: StartWebUiServerOptions): Promise<WebUiServerController>

export declare function gracefulShutdown(options?: { exitProcess?: boolean }): Promise<void>
export declare function setupProxy(app: Express): void
export declare function restartAxCode(): Promise<void>
export declare function parseArgs(argv?: string[]): {
  port: number
  host?: string
  uiPassword: string | null
}
