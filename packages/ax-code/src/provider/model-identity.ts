import { createHash, scryptSync } from "node:crypto"
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
const ENDPOINT_CREDENTIAL_SALT = "ax-code-endpoint-identity"
const MAX_CREDENTIAL_FINGERPRINTS = 64
const credentialFingerprints = new Map<string, string>()

/** Stretch a URL password so a leaked deployment key is not a fast hash of it. */
function credentialFingerprint(secret: string): string {
  const cached = credentialFingerprints.get(secret)
  if (cached !== undefined) {
    credentialFingerprints.delete(secret)
    credentialFingerprints.set(secret, cached)
    return cached
  }
  const fingerprint = scryptSync(secret, ENDPOINT_CREDENTIAL_SALT, 32).toString("hex")
  credentialFingerprints.set(secret, fingerprint)
  while (credentialFingerprints.size > MAX_CREDENTIAL_FINGERPRINTS) {
    const oldest = credentialFingerprints.keys().next().value
    if (oldest === undefined) break
    credentialFingerprints.delete(oldest)
  }
  return fingerprint
}

function withCredential(digest: string, credential: string | undefined): string {
  return credential ? `${digest}:${credential}` : digest
}

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

function endpointIdentity(value: string): { display?: string; key: string; credential?: string } {
  if (!value) return { key: "sdk-default" }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { key: configurationKey("unresolved-endpoint", value) }
  }
  const path = url.pathname.replace(/\/+$/, "")
  const display = `${url.origin}${path}`
  // Queries can route deployments, but may contain credentials. Keep their
  // values out of diagnostics. A non-empty URL password is stretched with
  // scrypt and appended after the SHA-256 fingerprint so the fast hash never
  // sees the secret.
  const query = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
  const key = configurationKey("endpoint", [display, query, url.username, ""])
  const secret = url.password
  if (!secret) return { display, key }
  return { display, key, credential: credentialFingerprint(secret) }
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
  const deploymentDigest = configurationKey("deployment-v2", [
    deployment.providerID,
    deployment.modelID,
    deployment.protocol,
    deployment.profile,
    endpoint.key,
  ])
  const deploymentKey = withCredential(deploymentDigest, endpoint.credential)
  return Object.freeze({
    selection: Object.freeze({ providerID: model.providerID, modelID: model.id }),
    deployment,
    deploymentKey,
    languageKey: withCredential(
      configurationKey("language-v2", [
        deploymentDigest,
        connectionOptions,
        model.options,
        model.headers,
        model.capabilities,
        model.capabilities && declaredCapabilityEvidence(model.capabilities),
        model.limit,
      ]),
      endpoint.credential,
    ),
  })
}
