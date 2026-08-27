/**
 * Visual model routing (ADR-047, Phase 3).
 *
 * Provider-aware routing that finds vision-capable alternatives when
 * the current model cannot handle visual tasks. Keeps capability.ts
 * pure (no Provider import) by handling the provider scan here.
 */

import { Provider } from "@/provider/provider-impl"
import type { ProviderModel } from "@/provider/model-info"
import type { ProviderInfo } from "@/provider/model-info"
import type { ProviderID, ModelID } from "@/provider/schema"
import type { MessageV2 } from "@/session/message-v2"
import {
  toVisualCapabilities,
  hasVisualCapabilities,
  missingCapabilityDiagnostic,
  type ModelVisualCapabilities,
} from "./capability"

export type VisionCapableModel = {
  providerID: string
  modelID: string
  name: string
}

/**
 * Resolve the model a tool-call's session is actually running on: the last
 * user message carries the model selection for the turn (the prompt loop
 * reads the same field). Returns undefined when no user message is present
 * (e.g. sub-agent or synthetic contexts) — callers fall back to the default
 * model in that case.
 */
export function sessionModelFromMessages(
  messages: MessageV2.WithParts[],
): { providerID: ProviderID; modelID: ModelID } | undefined {
  const lastUser = messages.findLast((m) => m.info.role === "user")
  if (!lastUser || lastUser.info.role !== "user") return undefined
  return lastUser.info.model
}

/**
 * Scan all loaded providers for models that support vision input.
 * Returns up to `limit` candidates, preferring models from the same
 * provider as `currentProviderID` (listed first).
 */
export async function findVisionCapableModels(currentProviderID?: string, limit = 5): Promise<VisionCapableModel[]> {
  const providers: Record<string, ProviderInfo> = await Provider.list()
  const candidates: VisionCapableModel[] = []
  const sameProvider: VisionCapableModel[] = []

  for (const [providerID, provider] of Object.entries(providers)) {
    for (const [modelID, model] of Object.entries(provider.models)) {
      if (!model.capabilities.input.image) continue
      const entry: VisionCapableModel = {
        providerID,
        modelID,
        name: model.name || modelID,
      }
      if (currentProviderID && providerID === currentProviderID) {
        sameProvider.push(entry)
      } else {
        candidates.push(entry)
      }
    }
  }

  return [...sameProvider, ...candidates].slice(0, limit)
}

/**
 * Build a diagnostic message with suggested alternative models when the
 * current model lacks required visual capabilities.
 *
 * Returns `undefined` when the model satisfies all requirements.
 */
export async function visualRoutingDiagnostic(input: {
  model: ProviderModel
  providerID: string
  required: Partial<ModelVisualCapabilities>
}): Promise<string | undefined> {
  const caps = toVisualCapabilities(input.model)
  const basicDiagnostic = missingCapabilityDiagnostic(caps, input.required, input.model.name)
  if (!basicDiagnostic) return undefined

  const alternatives = await findVisionCapableModels(input.providerID, 3)
  if (alternatives.length === 0) {
    return `${basicDiagnostic} No vision-capable models are currently configured.`
  }

  const suggestions = alternatives.map((a) => `  - ${a.name} (${a.providerID}/${a.modelID})`).join("\n")
  return `${basicDiagnostic}\n\nSuggested vision-capable alternatives:\n${suggestions}`
}

/**
 * Check whether the session's model supports the required visual
 * capabilities. Pass `options.model` (see `sessionModelFromMessages`) to gate
 * on the model the session is actually running; when omitted, the provider
 * default model is checked. Returns the model and its visual capabilities on
 * success, or a diagnostic message on failure.
 */
export async function checkVisualRouting(
  required: Partial<ModelVisualCapabilities>,
  options?: { model?: { providerID: ProviderID; modelID: ModelID } },
): Promise<
  | { ok: true; model: ProviderModel; providerID: string; caps: ModelVisualCapabilities }
  | { ok: false; diagnostic: string }
> {
  const target = options?.model ? await Provider.resolveRequestedModel(options.model) : await Provider.defaultModel()
  const model = await Provider.getModel(target.providerID, target.modelID)
  const caps = toVisualCapabilities(model)

  if (hasVisualCapabilities(caps, required)) {
    return { ok: true, model, providerID: target.providerID, caps }
  }

  const diagnostic = await visualRoutingDiagnostic({
    model,
    providerID: target.providerID,
    required,
  })

  return { ok: false, diagnostic: diagnostic ?? "Unknown capability mismatch." }
}
