export type DesktopBridgeInvoke = <TValue = unknown>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<TValue>

export type DesktopBridgeListen = (
  event: string,
  handler: (evt: { payload?: unknown }) => void,
) => Promise<() => void>

export type DesktopBridge = {
  runtime?: string
  invoke?: DesktopBridgeInvoke
  listen?: DesktopBridgeListen
  openDialog?: (options: Record<string, unknown>) => Promise<unknown>
}

type TauriShapedGlobal = {
  core?: { invoke?: DesktopBridgeInvoke }
  event?: { listen?: DesktopBridgeListen }
  dialog?: { open?: (options: Record<string, unknown>) => Promise<unknown> }
}

const getCanonicalDesktopBridge = (): DesktopBridge | undefined => {
  if (typeof window === "undefined") return undefined
  const bridge = window.__AX_CODE_DESKTOP__
  if (typeof bridge?.invoke !== "function") return undefined
  return bridge
}

const wrapTauriShapedGlobal = (tauri: TauriShapedGlobal | undefined): DesktopBridge | undefined => {
  if (typeof tauri?.core?.invoke !== "function") return undefined
  return {
    runtime: "electron",
    invoke: tauri.core.invoke,
    listen: tauri.event?.listen,
    openDialog: tauri.dialog?.open,
  }
}

export const getDesktopBridge = (): DesktopBridge | undefined => {
  const canonical = getCanonicalDesktopBridge()
  if (canonical) return canonical
  if (typeof window === "undefined") return undefined
  return wrapTauriShapedGlobal(window.__TAURI__)
}

export const hasDesktopBridge = (): boolean => typeof getDesktopBridge()?.invoke === "function"
