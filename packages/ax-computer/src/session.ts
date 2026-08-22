import type { ComputerAction, ComputerTarget } from "./action"
import type { ActionResult } from "./action"
import { ComputerUseError } from "./errors"
import type { ComputerUseProvider, ObserveScope } from "./provider"
import type { ComputerObservation } from "./types"

/**
 * Hard rule: one active provider per session.
 *
 * Element ids are only valid against the observation that issued them, so the
 * session namespaces them with an observation epoch (`e<epoch>:<raw id>`).
 * The epoch increments on every failover, which makes element ids captured
 * from the previous provider unresolvable — `act` rejects them with a
 * `stale_target` ComputerUseError instead of sending a dangling index to the
 * new backend (which may legitimately reuse the same raw indices).
 */
export class ComputerSession {
  private provider: ComputerUseProvider
  private epoch = 1
  private lastScope: ObserveScope | undefined
  /** session-scoped element id -> raw provider element id, current epoch only */
  private elements = new Map<string, string>()

  constructor(primary: ComputerUseProvider) {
    this.provider = primary
  }

  get activeProvider(): ComputerUseProvider {
    return this.provider
  }

  /** Convenience getter for the active provider's backend name (e.g. "cua", "ocu"). */
  get activeProviderName(): string {
    return this.provider.name
  }

  async observe(scope: ObserveScope): Promise<ComputerObservation> {
    const observation = await this.provider.observe(scope)
    this.lastScope = scope
    const elements = new Map<string, string>()
    const stamped = observation.elements.map((element) => {
      const id = `e${this.epoch}:${element.id}`
      elements.set(id, element.id)
      return { ...element, id }
    })
    // assign only after the map is fully built, so a provider error never
    // leaves half-registered ids behind
    this.elements = elements
    return { ...observation, elements: stamped }
  }

  async act(action: ComputerAction): Promise<ActionResult> {
    return this.provider.act(this.resolveAction(action))
  }

  /**
   * Stops routing acts to the current provider, disposes it, swaps in `next`,
   * and returns a fresh observation under the same scope as the last one
   * (desktop when nothing was observed yet).
   */
  async failover(next: ComputerUseProvider): Promise<ComputerObservation> {
    const previous = this.provider
    // Swap first: from here on acts route to `next` and old epoch ids reject.
    this.provider = next
    this.epoch += 1
    this.elements = new Map()
    await previous.dispose()
    return this.observe(this.lastScope ?? { desktop: true })
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
}
