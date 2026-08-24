import type { ActionResult, ComputerAction } from "./action"
import type { AppInfo, ComputerObservation, WindowInfo } from "./types"

export type ObserveScope = { app: string } | { windowId: string } | { desktop: true }

export interface ActBatchOptions {
  /**
   * Abort the remaining steps on the first refusal (default true). Batches
   * are NOT atomic — steps that already ran keep their UI effects.
   */
  stopOnError?: boolean
}

export interface PassiveObserveOptions {
  /**
   * null bootstraps a passive stream; a revision token resumes it. Passive
   * observations NEVER advance the element-id epoch and their frames carry
   * no targetable element ids (elements is always empty) — clients
   * re-snapshot with a legacy observe before element-targeted acts. A
   * passive revision advances only when the canonical masked frame content
   * changes; an unknown or evicted revision yields the latest full frame
   * with gap: true, never a silent unchanged.
   */
  sinceRevision: string | null
  /** long-poll bound in ms (default 0 = return immediately; max 5_000) */
  waitMs?: number
  /**
   * Frame hashes the client already holds; the provider may omit a
   * screenshot whose frameHash is listed (dedup).
   */
  have?: string[]
}

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
   *
   * With `options` (passive mode) the epoch rule flips: the observation
   * NEVER advances the element-id epoch and carries no targetable element
   * ids (elements is always empty). Providers without passive support may
   * ignore `options` and return a legacy observation (no revision/frameHash)
   * — callers detect support from the response shape.
   */
  observe(scope: ObserveScope, options?: PassiveObserveOptions): Promise<ComputerObservation>
  act(action: ComputerAction): Promise<ActionResult>
  /**
   * Execute an ordered batch of actions in one call (the protocol caps a
   * batch at 25 steps). NON-ATOMIC — there is no rollback; unless
   * stopOnError is false the first refused step aborts the rest. Per-step
   * outcomes come back in `results`. Optional: providers without batch
   * support leave this undefined and callers fall back to sequential act().
   */
  actBatch?(actions: ComputerAction[], options?: ActBatchOptions): Promise<ActionResult>
  dispose(): Promise<void>
}
