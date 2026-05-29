export type AxCodeAppRuntimeConfig =
  | {
      mode: "fixture"
    }
  | {
      mode: "live"
      baseUrl: string
      headers?: Record<string, string>
      directory?: string
      sessionLimit?: number
      scheduledTaskExecution?: {
        owner: "desktop-sidecar" | "attached-backend" | "external"
        stopsOnAppQuit: boolean
      }
    }

declare global {
  interface Window {
    __AX_CODE_APP_CONFIG__?: AxCodeAppRuntimeConfig
    axCodeDesktop?: {
      invoke(name: "path.reveal", payload: { path: string }): Promise<unknown>
      invoke(
        name: "notification.show",
        payload: { title: string; body?: string; source?: "scheduled-task"; silent?: boolean },
      ): Promise<unknown>
      invoke(name: "diagnostics.read", payload: Record<string, never>): Promise<unknown>
      invoke(name: "diagnostics.exportLogs", payload: { includeBackendLogs?: boolean }): Promise<unknown>
      invoke(name: "platform.capabilities", payload: Record<string, never>): Promise<unknown>
    }
  }
}

export function getRuntimeConfig(globalScope: { window?: Window } | undefined = globalThis) {
  const fromWindow = globalScope?.window?.__AX_CODE_APP_CONFIG__
  if (fromWindow) return fromWindow

  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {}
  const baseUrl = env.VITE_AX_CODE_BACKEND_URL
  if (typeof baseUrl === "string" && baseUrl.length > 0) {
    return {
      mode: "live",
      baseUrl,
      directory: env.VITE_AX_CODE_DIRECTORY,
    } satisfies AxCodeAppRuntimeConfig
  }

  return { mode: "fixture" } satisfies AxCodeAppRuntimeConfig
}
