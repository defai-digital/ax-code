import type { ActionResult, ComputerAction } from "./action"
import type { AppInfo, ComputerObservation, WindowInfo } from "./types"

export type ObserveScope = { app: string } | { windowId: string } | { desktop: true }

export interface ProviderCapabilities {
  /** action types this provider can execute */
  actions: ComputerAction["type"][]
  /** can deliver input to windows that are not frontmost */
  backgroundDelivery: boolean
  /** observations contain targetable elements */
  elementTargeting: boolean
  /** can activate an individual window (vs. only a whole app) */
  windowActivation: boolean
}

export interface ComputerUseProvider {
  readonly name: string
  capabilities(): ProviderCapabilities
  listApps(): Promise<AppInfo[]>
  listWindows?(): Promise<WindowInfo[]>
  /**
   * Element ids in the returned observation are only valid against this exact
   * observation, on this provider. Passing them to a different provider, or
   * after a newer observation replaced them, is a contract violation;
   * ComputerSession enforces this with observation epochs.
   */
  observe(scope: ObserveScope): Promise<ComputerObservation>
  act(action: ComputerAction): Promise<ActionResult>
  dispose(): Promise<void>
}
