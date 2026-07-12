import {
  connectTerminalStream,
  createTerminalSession,
  resizeTerminal,
  sendTerminalInput,
  closeTerminal,
  restartTerminalSession,
  forceKillTerminal,
} from "@openchamber/ui/terminalApi"
import type {
  TerminalAPI,
  TerminalHandlers,
  TerminalStreamOptions,
  CreateTerminalOptions,
  ResizeTerminalPayload,
  TerminalSession,
  ForceKillOptions,
} from "@openchamber/ui/api/types"
import { HTTP_DEFAULTS } from "./constants"

const getRetryPolicy = (options?: TerminalStreamOptions) => {
  const retry = options?.retry
  return {
    maxRetries: retry?.maxRetries ?? HTTP_DEFAULTS.terminal.defaultRetryMaxRetries,
    initialRetryDelay: retry?.initialDelayMs ?? HTTP_DEFAULTS.terminal.defaultInitialRetryDelayMs,
    maxRetryDelay: retry?.maxDelayMs ?? HTTP_DEFAULTS.terminal.defaultMaxRetryDelayMs,
    connectionTimeout: options?.connectionTimeoutMs ?? HTTP_DEFAULTS.terminal.defaultConnectionTimeoutMs,
    consumerKey: options?.consumerKey,
  }
}

export const createWebTerminalAPI = (): TerminalAPI => ({
  async createSession(options: CreateTerminalOptions): Promise<TerminalSession> {
    return createTerminalSession(options)
  },

  connect(sessionId: string, handlers: TerminalHandlers, options?: TerminalStreamOptions) {
    const unsubscribe = connectTerminalStream(sessionId, handlers.onEvent, handlers.onError, getRetryPolicy(options))

    return {
      close: () => unsubscribe(),
    }
  },

  async sendInput(sessionId: string, input: string): Promise<void> {
    await sendTerminalInput(sessionId, input)
  },

  async resize(payload: ResizeTerminalPayload): Promise<void> {
    await resizeTerminal(payload.sessionId, payload.cols, payload.rows)
  },

  async close(sessionId: string): Promise<void> {
    await closeTerminal(sessionId)
  },

  async restartSession(currentSessionId: string, options: CreateTerminalOptions): Promise<TerminalSession> {
    return restartTerminalSession(currentSessionId, {
      cwd: options.cwd ?? "",
      cols: options.cols,
      rows: options.rows,
    })
  },

  async forceKill(options: ForceKillOptions): Promise<void> {
    await forceKillTerminal(options)
  },
})
