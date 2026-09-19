import z from "zod"
import semver from "semver"
import { parseJsonResult } from "../../util/json-value"

export const AxEngineMtpPolicy = z.enum(["disabled", "auto", "required"])
export type AxEngineMtpPolicy = z.infer<typeof AxEngineMtpPolicy>

// Managed selection uses the MTP artifact; fail if its drafter is unavailable.
// Pure MTP describes n-gram stacking, not whether a model drafter is enabled.
const DEFAULT_MTP_POLICY: AxEngineMtpPolicy = "required"

export function resolveAxEngineMtpPolicy(options: Record<string, unknown> = {}): AxEngineMtpPolicy {
  const value = options.mtpPolicy ?? process.env.AX_ENGINE_MTP_POLICY ?? DEFAULT_MTP_POLICY
  const parsed = AxEngineMtpPolicy.safeParse(value)
  if (!parsed.success) {
    throw new Error("AX Engine mtpPolicy must be disabled, auto, or required")
  }
  return parsed.data
}

// 7.4.0 is the qualified explicit-policy contract. Legacy internal callers
// without a policy can retain their old launch, but its policy stays unknown.
export function axEngineMtpLaunchPolicy(policy: AxEngineMtpPolicy | undefined, version?: string) {
  if (policy !== undefined) AxEngineMtpPolicy.parse(policy)
  const parsed = version ? semver.coerce(version) : undefined
  if (!parsed || semver.lt(parsed, "7.4.0")) {
    if (policy !== undefined) throw new Error("Explicit AX Engine MTP policy requires AX Engine 7.4.0 or newer")
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
    const response = await fetch(new URL("/metrics", input.state.baseURL), {
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
