import type { ComputerAction, ComputerTarget } from "./action"
import type { ActionResult } from "./action"
import { ComputerUseError } from "./errors"
import type { ComputerUseProvider, ObserveScope, PassiveObserveOptions } from "./provider"
import type { ComputerObservation } from "./types"

/**
 * Hard rule: one active provider per session.
 *
 * Element ids are only valid against the observation that issued them, so the
 * session namespaces them with an observation epoch (`e<epoch>:<raw id>`).
 * Every successfully committed observation advances the epoch. Failover and
 * overlapping observations invalidate in-flight work before it can commit,
 * so `act` rejects stale ids instead of sending a dangling index to a changed
 * UI or a different backend (which may reuse the same raw indices).
 */
export class ComputerSession {
  private provider: ComputerUseProvider
  /** Epochs are issued only by successful observation commits; the first is e1. */
  private epoch = 0
  /** Changes on every observation commit or provider swap to reject overlapping work. */
  private revision = 0
  private lastScope: ObserveScope | undefined
  /** session-scoped element id -> raw provider element id, current epoch only */
  private elements = new Map<string, string>()

  constructor(primary: ComputerUseProvider) {
    this.provider = primary
  }

  get activeProvider(): ComputerUseProvider {
    return this.provider
  }

  /** Convenience getter for the active provider's backend name (e.g. "axnative", "cua"). */
  get activeProviderName(): string {
    return this.provider.name
  }

  async observe(scope: ObserveScope): Promise<ComputerObservation> {
    const provider = this.provider
    const revision = this.revision
    const observation = await provider.observe(scope)
    if (provider !== this.provider || revision !== this.revision) {
      throw this.supersededObservation(provider)
    }

    const epoch = this.epoch + 1
    const elements = new Map<string, string>()
    const stamped = observation.elements.map((element) => {
      const id = `e${epoch}:${element.id}`
      elements.set(id, element.id)
      return { ...element, id }
    })

    // Commit only after the complete stamped result and map are ready. There
    // is no await in this block, so an observation is either current in full
    // or rejected without changing the prior epoch, scope, or element map.
    this.epoch = epoch
    this.revision += 1
    this.lastScope = scope
    this.elements = elements
    return { ...observation, elements: stamped }
  }

  /**
   * Passive observe passthrough. Passive frames carry no targetable element
   * ids, so they must NEVER enter the commit path in observe() — committing
   * one would advance the epoch and replace the element map with an empty
   * frame, wiping every id in-flight acts might still target. This bypasses
   * epoch stamping entirely: no epoch advance, no element-map or scope
   * updates, no supersede checks (nothing is committed, so nothing can be
   * superseded).
   */
  async observePassive(scope: ObserveScope, options: PassiveObserveOptions): Promise<ComputerObservation> {
    return this.provider.observe(scope, options)
  }

  async act(action: ComputerAction): Promise<ActionResult> {
    // Resolve the target before bumping the revision: a stale/invalid target
    // throws here and never reaches the provider, so the UI never changes and
    // an observation already in flight must not be superseded by it.
    const resolved = this.resolveAction(action)
    // Acts mutate the UI, so an observation still in flight right now is a
    // snapshot of a UI that is about to change. Bump the revision so it
    // rejects with superseded_observation instead of committing as the
    // current epoch. Sequential observe -> act -> observe flows are
    // unaffected; only observes already in flight are superseded.
    this.revision += 1
    return this.provider.act(resolved)
  }

  /**
   * Stops routing acts to the current provider, swaps in `next`, disposes the
   * previous provider, and returns a fresh observation under the same scope as
   * the last one (desktop when nothing was observed yet).
   */
  async failover(next: ComputerUseProvider): Promise<ComputerObservation> {
    const previous = this.provider
    const scope: ObserveScope = this.lastScope ?? { desktop: true }
    if (next === previous) {
      // Self-swap must not dispose the live provider. Invalidate in-flight
      // observations and the current element map, then re-observe.
      this.revision += 1
      this.elements = new Map()
      return this.observe(scope)
    }
    // Swap first: from here on acts route to `next`, old element ids reject,
    // and observations still in flight on `previous` cannot commit.
    this.provider = next
    this.revision += 1
    const revision = this.revision
    this.elements = new Map()
    // Dispose is best-effort: routing already switched to `next`, so a teardown
    // failure on the old provider must not abort the failover and leave the
    // caller thinking the swap never happened.
    await previous.dispose().catch(() => {})
    if (next !== this.provider || revision !== this.revision) {
      throw this.supersededObservation(next)
    }
    return this.observe(scope)
  }

  async dispose(): Promise<void> {
    await this.provider.dispose()
  }

  private resolveAction(action: ComputerAction): ComputerAction {
    switch (action.type) {
      case "click":
        return { ...action, target: this.resolveTarget(action.target) }
      case "scroll":
        return action.target ? { ...action, target: this.resolveTarget(action.target) } : action
      case "set_value":
        return { ...action, target: this.resolveTarget(action.target) }
      case "move":
        return { ...action, target: this.resolveTarget(action.target) }
      case "wait":
        return action.condition.type === "screen_stable"
          ? action
          : { ...action, condition: { ...action.condition, target: this.resolveTarget(action.condition.target) } }
      case "drag":
        return { ...action, from: this.resolveTarget(action.from), to: this.resolveTarget(action.to) }
      default:
        return action
    }
  }

  private resolveTarget(target: ComputerTarget): ComputerTarget {
    if (target.kind !== "element") return target
    const raw = this.elements.get(target.id)
    if (raw === undefined) {
      throw new ComputerUseError(
        `element target "${target.id}" is not part of the current observation (epoch ${this.epoch}); re-observe before acting`,
        { provider: this.provider.name, code: "stale_target" },
      )
    }
    return { kind: "element", id: raw }
  }

  private supersededObservation(provider: ComputerUseProvider): ComputerUseError {
    return new ComputerUseError(
      `observation from provider "${provider.name}" was superseded before it could become current; observe again`,
      { provider: provider.name, code: "superseded_observation" },
    )
  }
}
