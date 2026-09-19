import fs from "fs/promises"
import path from "path"
import z from "zod"
import semver from "semver"
import { parseJsonResult } from "../../util/json-value"
import { assertLoopbackHttpUrl } from "../../runtime/listen-security"
import { AX_ENGINE_ERROR } from "./constants"

export const AxEngineMtpPolicy = z.enum(["disabled", "auto", "required"])
export type AxEngineMtpPolicy = z.infer<typeof AxEngineMtpPolicy>

/**
 * Terminal launch-validation failure: the pack, binary, or configured policy
 * cannot change between prompt-loop turns, so replaying the same request would
 * fail identically. The prompt loop stops on the first turn instead of burning
 * the consecutive-error budget on two more doomed engine setups.
 */
export class AxEngineMtpLaunchError extends Error {
  readonly isRetryable = false

  constructor(message: string) {
    super(message)
    this.name = "AxEngineMtpLaunchError"
  }
}

// Managed selection uses the MTP artifact; fail if its drafter is unavailable.
// Pure MTP describes n-gram stacking, not whether a model drafter is enabled.
const DEFAULT_MTP_POLICY: AxEngineMtpPolicy = "required"

export function resolveAxEngineMtpPolicy(options: Record<string, unknown> = {}): AxEngineMtpPolicy {
  const value = options.mtpPolicy ?? process.env.AX_ENGINE_MTP_POLICY ?? DEFAULT_MTP_POLICY
  const parsed = AxEngineMtpPolicy.safeParse(value)
  if (!parsed.success) {
    throw new AxEngineMtpLaunchError("AX Engine mtpPolicy must be disabled, auto, or required")
  }
  return parsed.data
}

// 7.4.0 is the qualified explicit-policy contract. Legacy internal callers
// without a policy can retain their old launch, but its policy stays unknown.
export function axEngineMtpLaunchPolicy(policy: AxEngineMtpPolicy | undefined, version?: string) {
  if (policy !== undefined) AxEngineMtpPolicy.parse(policy)
  const parsed = version ? semver.coerce(version) : undefined
  if (!parsed || semver.lt(parsed, "7.4.0")) {
    if (policy !== undefined)
      throw new AxEngineMtpLaunchError("Explicit AX Engine MTP policy requires AX Engine 7.4.0 or newer")
    return undefined
  }
  return policy ?? DEFAULT_MTP_POLICY
}

export function axEngineMtpLaunchArgs(policy: AxEngineMtpPolicy | undefined, version?: string): string[] {
  const resolved = axEngineMtpLaunchPolicy(policy, version)
  if (resolved === undefined) return ["--disable-ngram-acceleration"]
  // The blanket disable flag also turns Auto into Disabled in AX Engine.
  // Required is explicit and fails in the engine if no drafter is admitted.
  return [...(resolved === "auto" ? [] : ["--disable-ngram-acceleration"]), "--mlx-mtp-policy", resolved]
}

// Tiel-class AXQuant packs ship MTP sidecar tensors under the
// `language_model.mtp.*` HF namespace. Engine builds predating the sidecar
// namespace normalization (post-v7.4.0) only look up bare `mtp.*` keys, so the
// drafter never attaches and a `required` policy kills the server after a
// multi-minute weight load with Engine(MlxMtpRequiredButUnavailable). Detect
// that pairing before spawning and fail with an actionable version error.
const MTP_SIDECAR_FILE = "mtp.safetensors"
const MTP_SIDECAR_PREFIXED_NAMESPACE = "language_model.mtp."
const MTP_SIDECAR_BARE_KEY = '"mtp.'
const MTP_SIDECAR_HEADER_MAX_BYTES = 4 * 1024 * 1024
const AX_ENGINE_SERVER_BINARY_NAME = "ax-engine-server"
// Distinctive literal compiled into engines carrying the sidecar namespace
// normalization (ax-engine weights.rs normalize_mtp_sidecar_namespace).
const MTP_NAMESPACE_NORMALIZATION_MARKER = "MTP sidecar namespace normalization"

export type AxEngineMtpSidecarNamespace = "bare" | "prefixed" | "unknown"

const sidecarNamespaceCache = new Map<string, { mtimeMs: number; namespace: AxEngineMtpSidecarNamespace }>()
const binaryCapabilityCache = new Map<string, { mtimeMs: number; size: number; supports: boolean }>()

async function detectMtpSidecarNamespace(
  handle: Awaited<ReturnType<typeof fs.open>>,
): Promise<AxEngineMtpSidecarNamespace> {
  const lengthBuffer = Buffer.alloc(8)
  const head = await handle.read(lengthBuffer, 0, 8, 0)
  if (head.bytesRead !== 8) return "unknown"
  const headerBytes = Number(lengthBuffer.readBigUInt64LE(0))
  if (!Number.isSafeInteger(headerBytes) || headerBytes <= 0) return "unknown"
  const readable = Math.min(headerBytes, MTP_SIDECAR_HEADER_MAX_BYTES)
  const buffer = Buffer.alloc(readable)
  const result = await handle.read(buffer, 0, readable, 8)
  if (result.bytesRead <= 0) return "unknown"
  const view = buffer.subarray(0, result.bytesRead)
  if (view.includes(MTP_SIDECAR_PREFIXED_NAMESPACE)) return "prefixed"
  if (view.includes(MTP_SIDECAR_BARE_KEY)) return "bare"
  return "unknown"
}

/** Read the pack's sidecar tensor namespace from its header; failures stay "unknown" (fail-open). */
export async function readAxEngineMtpSidecarNamespace(modelPath: string): Promise<AxEngineMtpSidecarNamespace> {
  const file = path.join(modelPath, MTP_SIDECAR_FILE)
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(file, "r")
    const stat = await handle.stat()
    const cached = sidecarNamespaceCache.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.namespace
    const namespace = await detectMtpSidecarNamespace(handle)
    sidecarNamespaceCache.set(file, { mtimeMs: stat.mtimeMs, namespace })
    return namespace
  } catch {
    return "unknown"
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * Whether the resolved binary's sibling `ax-engine-server` carries the sidecar
 * namespace normalization. `undefined` means the probe was inconclusive.
 */
export async function axEngineSupportsPrefixedMtpSidecar(binaryPath: string): Promise<boolean | undefined> {
  try {
    const launcher = await fs.realpath(binaryPath)
    const server = await fs.realpath(path.join(path.dirname(launcher), AX_ENGINE_SERVER_BINARY_NAME))
    const stat = await fs.stat(server)
    const cached = binaryCapabilityCache.get(server)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.supports
    const supports = (await fs.readFile(server)).includes(MTP_NAMESPACE_NORMALIZATION_MARKER)
    binaryCapabilityCache.set(server, { mtimeMs: stat.mtimeMs, size: stat.size, supports })
    return supports
  } catch {
    return undefined
  }
}

/**
 * Fail fast when the launch would deterministically die in the engine: a
 * `required` MTP policy over a `language_model.mtp.*` sidecar on an engine
 * that provably lacks namespace normalization. Inconclusive probes never
 * block a launch — the engine's own startup diagnostics remain the fallback.
 */
export async function assertAxEngineMtpPackCompatibility(input: {
  modelPath: string
  binaryPath: string
  policy?: AxEngineMtpPolicy
  binaryVersion?: string
}): Promise<void> {
  if (axEngineMtpLaunchPolicy(input.policy, input.binaryVersion) !== "required") return
  if ((await readAxEngineMtpSidecarNamespace(input.modelPath)) !== "prefixed") return
  if ((await axEngineSupportsPrefixedMtpSidecar(input.binaryPath)) !== false) return
  throw new AxEngineMtpLaunchError(
    `${AX_ENGINE_ERROR.VersionUnsupported}: this model pack's MTP sidecar uses the ${MTP_SIDECAR_PREFIXED_NAMESPACE}* tensor namespace, which the resolved ax-engine-server cannot load (MTP sidecar namespace normalization landed after ax-engine v7.4.0)\n` +
      `Resolved binary: ${input.binaryPath}\n` +
      `Model pack: ${path.join(input.modelPath, MTP_SIDECAR_FILE)}\n` +
      "Point provider.ax-engine.options.binaryPath or AX_ENGINE_BIN at an AX Engine build with Tiel pack support, or upgrade AX Engine.",
  )
}

export const AxEngineMtpStatus = z.object({
  requestedPolicy: AxEngineMtpPolicy,
  launchedPolicy: AxEngineMtpPolicy.optional(),
  effective: z.enum(["active", "inactive", "unknown"]),
  pendingRestart: z.boolean(),
  observedAt: z.number().optional(),
  draftedTokens: z.number().nonnegative().optional(),
  acceptedTokens: z.number().nonnegative().optional(),
})
export type AxEngineMtpStatus = z.infer<typeof AxEngineMtpStatus>

/** Read exact-model samples; capability/default metadata is not activation. */
export function parseAxEngineMtpMetrics(text: string, modelID: string) {
  function sample(name: string) {
    const rows = text.split("\n").flatMap((line) => {
      const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{.*\})?\s+(\S+)(?:\s+\S+)?\s*$/)
      if (!match || match[1] !== name) return []
      const value = Number(match[3])
      const label = match[2]?.match(/(?:\{|,)\s*model=("(?:\\.|[^"\\])*")/)
      if (!label) return []
      const parsed = parseJsonResult(label[1])
      if (!parsed.ok || typeof parsed.value !== "string") return []
      return [{ model: parsed.value, value: Number.isFinite(value) && value >= 0 ? value : undefined }]
    })
    // Unlabeled values sum all models and cannot identify an observed model.
    // Neither an aggregate nor another model establishes this model's state.
    const matching = rows.filter((row) => row.model === modelID)
    return matching.length === 1 ? matching[0].value : undefined
  }
  const active = sample("ax_engine_mlx_mtp_model_policy_active")
  return {
    effective: active === 1 ? ("active" as const) : active === 0 ? ("inactive" as const) : ("unknown" as const),
    draftedTokens: sample("ax_engine_mtp_draft_tokens_total"),
    acceptedTokens: sample("ax_engine_mtp_accepted_tokens_total"),
  }
}

export async function observeAxEngineMtp(input: {
  requestedPolicy: AxEngineMtpPolicy
  state?: { mtpPolicy?: AxEngineMtpPolicy; baseURL: string; modelID: string; apiModelID?: string }
  ready: boolean
  apiKey: string
}): Promise<AxEngineMtpStatus> {
  // Legacy stacking modes and flags do not establish the launched policy.
  const launchedPolicy = input.state?.mtpPolicy
  const status: AxEngineMtpStatus = {
    requestedPolicy: input.requestedPolicy,
    launchedPolicy,
    effective: "unknown",
    pendingRestart: input.state !== undefined && launchedPolicy !== input.requestedPolicy,
  }
  if (!input.ready || !input.state) return status
  try {
    const origin = assertLoopbackHttpUrl(input.state.baseURL, "AX Engine metrics URL")
    const response = await fetch(new URL("/metrics", origin), {
      headers: { authorization: `Bearer ${input.apiKey}` },
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    })
    if (!response.ok) {
      await response.body?.cancel()
      return status
    }
    return {
      ...status,
      ...parseAxEngineMtpMetrics(await response.text(), input.state.apiModelID ?? input.state.modelID),
      observedAt: Date.now(),
    }
  } catch {
    return status
  }
}
