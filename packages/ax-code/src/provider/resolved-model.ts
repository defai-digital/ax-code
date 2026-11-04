import type { ProviderModel } from "./model-info"
import { resolveModelIdentity } from "./model-identity"
import { modelCapabilityEvidence, resolveCapabilityEvidence } from "./capability-evidence"
import { findRegisteredModelCapabilities } from "./model-capabilities"

/** Credential-free immutable contract consumed by policy, snapshots and compilation. */
export function resolveModel(model: ProviderModel, connectionOptions: Record<string, unknown> = {}) {
  const identity = resolveModelIdentity(model, connectionOptions)
  const declared = modelCapabilityEvidence(model.capabilities)
  const family = findRegisteredModelCapabilities(identity.deployment.modelID, model.providerID)
  const heuristic = resolveCapabilityEvidence(
    {
      thinking: family ? family.thinking === "supported" || family.thinking === "experimental" : undefined,
      toolCalling: family ? family.toolCalling === "supported" || family.toolCalling === "experimental" : undefined,
      structuredOutput: family
        ? family.structuredOutput === "supported" || family.structuredOutput === "experimental"
        : undefined,
    },
    "heuristic",
  )
  return Object.freeze({
    ...identity,
    capabilities: declared,
    capabilityHints: heuristic,
    limit: Object.freeze({ ...model.limit }),
    status: model.status,
  })
}

export type ResolvedModel = ReturnType<typeof resolveModel>

export function observedCapabilitiesForModel(model: ProviderModel) {
  const resolved = resolveModel(model)
  const flag = (name: "thinking" | "toolCalling") =>
    resolved.capabilities[name].state === "unknown"
      ? ("unknown" as const)
      : resolved.capabilities[name].state === "supported"
  return { contextWindow: model.limit.context, thinking: flag("thinking"), toolCalling: flag("toolCalling") }
}
