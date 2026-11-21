import { Instance } from "@/project/instance"
import { Bus } from "@/bus"
import { NotificationEvent } from "@/notification/events"
import { Provider } from "../provider/provider"
import type { ModelID, ProviderID } from "@/provider/schema"
import { Config } from "../config/config"
import { Log } from "../util/log"

/**
 * One resolution path for auxiliary model work (title, recap, compaction,
 * complexity classification and complexity routing).
 *
 * A configured auxiliary target (a purpose pin such as `agent.title.model`, or
 * `small_model`) is a preference. When it cannot be resolved before any
 * request is sent (unknown model, unconfigured provider, or a local session
 * whose target would leave the local provider) the work degrades to the
 * session primary when the caller supplies one, otherwise it is skipped.
 * The primary is the exact model the user already selected for this
 * conversation, so the fallback adds no new recipient and is not catalog
 * substitution. Execution-time recovery (429/5xx after dispatch) is out of
 * scope here and stays with the explicit `llm_routing.fallback` list.
 *
 * Errors resolving the primary itself propagate unchanged.
 */
export namespace AuxiliaryModel {
  const log = Log.create({ service: "session.auxiliary-model" })

  export type Purpose = "title" | "recap" | "compaction" | "classify" | "route"

  export type Ref = { providerID: ProviderID; modelID: ModelID }

  export type DegradedReason = "unavailable" | "local_route"

  export type Degraded = {
    configKey: string
    target: string
    reason: DegradedReason
  }

  export type Resolution =
    | { model: Provider.Model; source: "pin" | "small_model" | "primary"; degraded: Degraded[] }
    | { model: undefined; source: "none"; degraded: Degraded[] }

  export type Input = {
    purpose: Purpose
    /** Provider the session is anchored on; local-route eligibility is judged against it. */
    anchor: ProviderID
    /** Session primary. When omitted, an unresolvable auxiliary target skips the work instead. */
    primary?: Ref
    /** Exact purpose pin, e.g. `agent.title.model`. Tried before `small_model`. */
    pin?: { configKey: string; model: Ref }
    /** Whether `small_model` applies to this purpose. Compaction does not use it. */
    smallModel: boolean
  }

  const NOTICE_DURATION_MS = 15_000

  const notified = Instance.state(() => new Set<string>())

  function isUnavailable(error: unknown): boolean {
    return Provider.ModelNotFoundError.isInstance(error) || Provider.InitError.isInstance(error)
  }

  async function eligible(anchor: ProviderID, target: ProviderID): Promise<boolean> {
    if (anchor === target) return true
    return !(await Provider.isLocalProvider(anchor))
  }

  async function tryTarget(
    anchor: ProviderID,
    configKey: string,
    ref: Ref,
    degraded: Degraded[],
  ): Promise<Provider.Model | undefined> {
    const target = `${ref.providerID}/${ref.modelID}`
    if (!(await eligible(anchor, ref.providerID))) {
      degraded.push({ configKey, target, reason: "local_route" })
      return undefined
    }
    try {
      return await Provider.getModel(ref.providerID, ref.modelID)
    } catch (error) {
      if (!isUnavailable(error)) throw error
      degraded.push({ configKey, target, reason: "unavailable" })
      return undefined
    }
  }

  function describeReason(reason: DegradedReason, anchor: ProviderID): string {
    return reason === "local_route"
      ? `it would leave local provider ${anchor}`
      : "the provider or model is not available"
  }

  type Used = { kind: "pin" | "small_model" | "primary"; ref: Ref } | undefined

  function outcomeText(purpose: Purpose, used: Used): string {
    if (!used) return `${purpose} is skipped`
    const ref = `${used.ref.providerID}/${used.ref.modelID}`
    return used.kind === "primary" ? `${purpose} uses the session model ${ref}` : `${purpose} uses ${ref}`
  }

  function announce(input: Input, degraded: Degraded[], used: Used): void {
    for (const item of degraded) {
      const key = `${item.configKey}|${item.target}|${item.reason}|${input.purpose}`
      const notices = notified()
      if (notices.has(key)) continue
      notices.add(key)
      const outcome = outcomeText(input.purpose, used)
      const message = `${item.configKey} selects ${item.target}, but ${describeReason(item.reason, input.anchor)}; ${outcome}. Update or remove ${item.configKey} in your config.`
      log.warn("auxiliary model degraded", {
        purpose: input.purpose,
        configKey: item.configKey,
        target: item.target,
        reason: item.reason,
        used: used ? `${used.ref.providerID}/${used.ref.modelID}` : "skip",
      })
      Bus.publishDetached(NotificationEvent.ToastShow, {
        title: "Auxiliary model unavailable",
        message,
        variant: "warning",
        duration: NOTICE_DURATION_MS,
      })
    }
  }

  export async function resolve(input: Input): Promise<Resolution> {
    const degraded: Degraded[] = []

    if (input.pin) {
      const model = await tryTarget(input.anchor, input.pin.configKey, input.pin.model, degraded)
      if (model) return { model, source: "pin", degraded }
    }

    if (input.smallModel) {
      const configured = (await Config.get()).small_model
      if (configured) {
        const ref = Provider.parseModel(configured)
        const model = await tryTarget(input.anchor, "small_model", ref, degraded)
        if (model) {
          announce(input, degraded, { kind: "small_model", ref })
          return { model, source: "small_model", degraded }
        }
      }
    }

    if (!input.primary) {
      announce(input, degraded, undefined)
      return { model: undefined, source: "none", degraded }
    }
    const model = await Provider.getModel(input.primary.providerID, input.primary.modelID)
    announce(input, degraded, { kind: "primary", ref: input.primary })
    return { model, source: "primary", degraded }
  }
}
