/**
 * Work model qualification (ADR-052 D7).
 *
 * `supportsLongAgent` is not visual eligibility. Callers must pass the
 * active session model — never Provider.defaultModel().
 */

export type WorkModelCapabilities = {
  imageInput: boolean
  toolCall: boolean
}

export type WorkModelRef = {
  providerID: string
  modelID: string
  capabilities: WorkModelCapabilities
}

const CLOUD_PROVIDERS = new Set([
  "openai",
  "xai",
  "alibaba-token-plan",
  "alibaba-token-plan-cn",
  "alibaba-coding-plan",
  "alibaba-coding-plan-cn",
])

/** Checked-in Work qualification table. Expand only after a live image-in-tool-result probe. */
const QUALIFIED: ReadonlyArray<{ providerID: string; modelID: string }> = [
  { providerID: "openai", modelID: "gpt-5.6-sol" },
  { providerID: "xai", modelID: "grok-4.5" },
]

export function isCloudWorkProvider(providerID: string) {
  return CLOUD_PROVIDERS.has(providerID)
}

export function isQualifiedWorkModel(providerID: string, modelID: string) {
  return QUALIFIED.some((entry) => entry.providerID === providerID && entry.modelID === modelID)
}

export function workModelIneligibleReason(input: WorkModelRef): string | undefined {
  if (!isCloudWorkProvider(input.providerID)) {
    return `Provider "${input.providerID}" is not a cloud Work route`
  }
  if (!input.capabilities.imageInput) {
    return `Model "${input.providerID}/${input.modelID}" does not accept image input`
  }
  if (!input.capabilities.toolCall) {
    return `Model "${input.providerID}/${input.modelID}" does not support tool calls`
  }
  if (!isQualifiedWorkModel(input.providerID, input.modelID)) {
    return `Model "${input.providerID}/${input.modelID}" is not in the Work qualification table`
  }
  return undefined
}

export function isEligibleWorkModel(input: WorkModelRef) {
  return workModelIneligibleReason(input) === undefined
}
