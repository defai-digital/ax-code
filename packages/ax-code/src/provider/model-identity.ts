import { createHash } from "node:crypto"
import { resolveProtocolProfile } from "./protocol-profile"
import { declaredCapabilityEvidence } from "./capability-evidence"

/** Selection names are UI/configuration identities, never deployment identities. */
export type ModelIdentityInput = {
  providerID: string
  id: string
  api: { id: string; url: string; npm: string }
  options?: Record<string, unknown>
  headers?: Record<string, string>
  family?: string
  capabilities?: object
  limit?: object
}

export type ResolvedModelIdentity = Readonly<{
  selection: Readonly<{ providerID: string; modelID: string }>
  deployment: Readonly<{ providerID: string; modelID: string; protocol: string; profile: string; endpoint?: string }>
  deploymentKey: string
  languageKey: string
}>

const opaqueIDs = new WeakMap<object, number>()
let nextOpaqueID = 0

function opaqueID(value: object) {
  let id = opaqueIDs.get(value)
  if (id === undefined) opaqueIDs.set(value, (id = ++nextOpaqueID))
  return id
}

/** Canonical configuration identity, including callbacks without serializing secrets. */
export function configurationKey(scope: string, value: unknown): string {
  const seen = new Map<object, number>()
  const encode = (item: unknown): unknown => {
    if (item === undefined) return ["undefined"]
    if (typeof item === "bigint") return ["bigint", item.toString()]
    if (typeof item === "function") return ["function", opaqueID(item)]
    if (typeof item !== "object" || item === null) return [typeof item, String(item)]
    const reference = seen.get(item)
    if (reference !== undefined) return ["reference", reference]
    seen.set(item, seen.size)
    if (Array.isArray(item)) return ["array", item.map(encode)]
    if (item instanceof Date) return ["date", item.toISOString()]
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      return ["opaque", opaqueID(item)]
    return [
      "object",
      Object.keys(item)
        .sort()
        .map((key) => [key, encode((item as Record<string, unknown>)[key])]),
    ]
  }
  return `${scope}:${createHash("sha256")
    .update(JSON.stringify(encode(value)))
    .digest("hex")}`
}

function endpointIdentity(value: string): { display?: string; key: string } {
  if (!value) return { key: "sdk-default" }
  try {
    const url = new URL(value)
    const path = url.pathname.replace(/\/+$/, "")
    const display = `${url.origin}${path}`
    // Queries can route deployments, but may contain credentials. Hash their
    // values rather than exposing them in diagnostics or calibration keys.
    const query = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    return { display, key: configurationKey("endpoint", [display, query, url.username, url.password]) }
  } catch {
    return { key: configurationKey("unresolved-endpoint", value) }
  }
}

export function resolveModelIdentity(
  model: ModelIdentityInput,
  connectionOptions: Record<string, unknown> = {},
): ResolvedModelIdentity {
  const endpoint = endpointIdentity(
    typeof connectionOptions.baseURL === "string" && connectionOptions.baseURL
      ? connectionOptions.baseURL
      : model.api.url,
  )
  const profile = resolveProtocolProfile({
    ...model,
    api: { ...model.api, id: model.api.id || model.id, url: endpoint.display ?? model.api.url },
  })
  const deployment = Object.freeze({
    providerID: model.providerID,
    modelID: model.api.id || model.id,
    protocol: model.api.npm || profile.adapter,
    profile: `${profile.id}@${profile.revision}`,
    ...(endpoint.display ? { endpoint: endpoint.display } : {}),
  })
  const deploymentKey = configurationKey("deployment-v2", [
    deployment.providerID,
    deployment.modelID,
    deployment.protocol,
    deployment.profile,
    endpoint.key,
  ])
  return Object.freeze({
    selection: Object.freeze({ providerID: model.providerID, modelID: model.id }),
    deployment,
    deploymentKey,
    languageKey: configurationKey("language-v2", [
      deploymentKey,
      connectionOptions,
      model.options,
      model.headers,
      model.capabilities,
      model.capabilities && declaredCapabilityEvidence(model.capabilities),
      model.limit,
    ]),
  })
}
