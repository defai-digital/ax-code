export const PRIVATE_GPU_NPM = "@ai-sdk/openai-compatible"

/** Cold dedicated GPUs can take a while to emit the first token. */
export const PRIVATE_GPU_REQUEST_TIMEOUT_MS = 180_000
export const PRIVATE_GPU_DISCOVERY_TIMEOUT_MS = 10_000

export type PrivateGpuPathStyle = "openai-v1" | "runpod-openai" | "volcengine-ark"
export type PrivateGpuMode = "catalog" | "dedicated"

export type PrivateGpuVendor = {
  id: string
  name: string
  mode: PrivateGpuMode
  envKey: string
  envBaseURL?: string
  npm: string
  /** Hosted default used when the vendor has a public OpenAI-compatible root. */
  defaultApi?: string
  pathStyle: PrivateGpuPathStyle
  tokenLabel: string
  urlLabel: string
  urlPlaceholder: string
  tokenPlaceholder: string
  hint: string
}

/**
 * Private GPU cloud vendors.
 *
 * Catalog vendors follow OpenCode / models.dev: API key only, model list from
 * the bundled snapshot. Dedicated vendors follow the PAI-EAS pattern: unique
 * URL + token, then GET /v1/models (or the vendor equivalent).
 */
export const PRIVATE_GPU_VENDORS: readonly PrivateGpuVendor[] = [
  {
    id: "alibaba-pai",
    name: "Alibaba PAI-EAS",
    mode: "dedicated",
    envKey: "ALIBABA_PAI_API_KEY",
    envBaseURL: "ALIBABA_PAI_BASE_URL",
    npm: PRIVATE_GPU_NPM,
    pathStyle: "openai-v1",
    tokenLabel: "EAS token",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "http://xxxx.pai-eas.aliyuncs.com/api/predict/your_service",
    tokenPlaceholder: "EAS token",
    hint: "Paste the EAS access address and token. AX Code calls GET /v1/models.",
  },
  {
    id: "runpod",
    name: "RunPod",
    mode: "dedicated",
    envKey: "RUNPOD_API_KEY",
    envBaseURL: "RUNPOD_BASE_URL",
    npm: PRIVATE_GPU_NPM,
    pathStyle: "runpod-openai",
    tokenLabel: "API key",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://api.runpod.ai/v2/your-endpoint-id",
    tokenPlaceholder: "RunPod API key",
    hint: "Serverless OpenAI URL or proxy host. /openai/v1 is added for api.runpod.ai/v2/{id}.",
  },
  {
    id: "huggingface-endpoints",
    name: "Hugging Face Endpoints",
    mode: "dedicated",
    envKey: "HF_ENDPOINTS_TOKEN",
    envBaseURL: "HF_ENDPOINTS_BASE_URL",
    npm: PRIVATE_GPU_NPM,
    pathStyle: "openai-v1",
    tokenLabel: "HF token",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://xxxx.endpoints.huggingface.cloud",
    tokenPlaceholder: "hf_...",
    hint: "Dedicated Inference Endpoint (TGI / vLLM). Not the hosted Hugging Face router.",
  },
  {
    id: "sagemaker",
    name: "Amazon SageMaker",
    mode: "dedicated",
    envKey: "SAGEMAKER_API_KEY",
    envBaseURL: "SAGEMAKER_BASE_URL",
    npm: PRIVATE_GPU_NPM,
    pathStyle: "openai-v1",
    tokenLabel: "Token",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://your-sagemaker-openai-compatible.example/v1",
    tokenPlaceholder: "Bearer token",
    hint: "OpenAI-compatible SageMaker URL (vLLM / TGI / API Gateway). Not AWS SigV4.",
  },
  {
    id: "volcengine-ark",
    name: "Volcengine Ark",
    mode: "dedicated",
    envKey: "ARK_API_KEY",
    envBaseURL: "ARK_BASE_URL",
    npm: PRIVATE_GPU_NPM,
    defaultApi: "https://ark.cn-beijing.volces.com/api/v3",
    pathStyle: "volcengine-ark",
    tokenLabel: "API key",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://ark.cn-beijing.volces.com/api/v3",
    tokenPlaceholder: "Ark API key",
    hint: "Ark OpenAI-compatible root or a dedicated inference URL. Defaults to /api/v3.",
  },
  {
    id: "modelarts",
    name: "Huawei ModelArts",
    mode: "dedicated",
    envKey: "MODELARTS_API_KEY",
    envBaseURL: "MODELARTS_BASE_URL",
    npm: PRIVATE_GPU_NPM,
    pathStyle: "openai-v1",
    tokenLabel: "Token",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://xxxx.modelarts.huaweicloud.com/v1",
    tokenPlaceholder: "ModelArts token",
    hint: "Dedicated ModelArts OpenAI-compatible infer endpoint.",
  },
  {
    id: "tencent-ti",
    name: "Tencent TI",
    mode: "dedicated",
    envKey: "TENCENT_TI_API_KEY",
    envBaseURL: "TENCENT_TI_BASE_URL",
    npm: PRIVATE_GPU_NPM,
    defaultApi: "https://api.lkeap.cloud.tencent.com/v1",
    pathStyle: "openai-v1",
    tokenLabel: "API key",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://api.lkeap.cloud.tencent.com/v1",
    tokenPlaceholder: "Tencent TI / LKEAP key",
    hint: "Tencent TI-ONE / LKEAP OpenAI-compatible URL, or a dedicated TI endpoint.",
  },
  {
    id: "nebius",
    name: "Nebius Token Factory",
    mode: "catalog",
    envKey: "NEBIUS_API_KEY",
    npm: PRIVATE_GPU_NPM,
    defaultApi: "https://api.tokenfactory.nebius.com/v1",
    pathStyle: "openai-v1",
    tokenLabel: "API key",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://api.tokenfactory.nebius.com/v1",
    tokenPlaceholder: "Nebius API key",
    hint: "Hosted Nebius Token Factory catalog. Connect with an API key.",
  },
  {
    id: "fireworks-ai",
    name: "Fireworks AI",
    mode: "catalog",
    envKey: "FIREWORKS_API_KEY",
    npm: PRIVATE_GPU_NPM,
    defaultApi: "https://api.fireworks.ai/inference/v1",
    pathStyle: "openai-v1",
    tokenLabel: "API key",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://api.fireworks.ai/inference/v1",
    tokenPlaceholder: "Fireworks API key",
    hint: "Hosted Fireworks model catalog. Connect with an API key.",
  },
  {
    id: "togetherai",
    name: "Together AI",
    mode: "catalog",
    envKey: "TOGETHER_API_KEY",
    npm: "@ai-sdk/togetherai",
    pathStyle: "openai-v1",
    tokenLabel: "API key",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "",
    tokenPlaceholder: "Together API key",
    hint: "Hosted Together model catalog. Connect with an API key.",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    mode: "catalog",
    envKey: "HF_TOKEN",
    npm: PRIVATE_GPU_NPM,
    defaultApi: "https://router.huggingface.co/v1",
    pathStyle: "openai-v1",
    tokenLabel: "HF token",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://router.huggingface.co/v1",
    tokenPlaceholder: "hf_...",
    hint: "Hosted Hugging Face Inference Providers router. Not a dedicated endpoint.",
  },
  {
    id: "baseten",
    name: "Baseten",
    mode: "catalog",
    envKey: "BASETEN_API_KEY",
    npm: PRIVATE_GPU_NPM,
    defaultApi: "https://inference.baseten.co/v1",
    pathStyle: "openai-v1",
    tokenLabel: "API key",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://inference.baseten.co/v1",
    tokenPlaceholder: "Baseten API key",
    hint: "Hosted Baseten model catalog. Connect with an API key.",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    mode: "catalog",
    envKey: "NVIDIA_API_KEY",
    npm: PRIVATE_GPU_NPM,
    defaultApi: "https://integrate.api.nvidia.com/v1",
    pathStyle: "openai-v1",
    tokenLabel: "API key",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "https://integrate.api.nvidia.com/v1",
    tokenPlaceholder: "NVIDIA API key",
    hint: "Hosted NVIDIA NIM catalog. Connect with an API key.",
  },
  {
    id: "deepinfra",
    name: "Deep Infra",
    mode: "catalog",
    envKey: "DEEPINFRA_API_KEY",
    npm: "@ai-sdk/deepinfra",
    pathStyle: "openai-v1",
    tokenLabel: "API key",
    urlLabel: "Endpoint URL",
    urlPlaceholder: "",
    tokenPlaceholder: "Deep Infra API key",
    hint: "Hosted Deep Infra model catalog. Connect with an API key.",
  },
] as const

const VENDORS_BY_ID = new Map(PRIVATE_GPU_VENDORS.map((vendor) => [vendor.id, vendor]))

export const PRIVATE_GPU_PROVIDER_IDS = PRIVATE_GPU_VENDORS.map((vendor) => vendor.id)

export const DEDICATED_PRIVATE_GPU_VENDORS = PRIVATE_GPU_VENDORS.filter((vendor) => vendor.mode === "dedicated")

export const CATALOG_PRIVATE_GPU_VENDORS = PRIVATE_GPU_VENDORS.filter((vendor) => vendor.mode === "catalog")

export const DEDICATED_PRIVATE_GPU_PROVIDER_IDS = DEDICATED_PRIVATE_GPU_VENDORS.map((vendor) => vendor.id)

export const CATALOG_PRIVATE_GPU_PROVIDER_IDS = CATALOG_PRIVATE_GPU_VENDORS.map((vendor) => vendor.id)

export function privateGpuVendor(id: string) {
  return VENDORS_BY_ID.get(id)
}

export function isPrivateGpuProviderID(id: string) {
  return VENDORS_BY_ID.has(id)
}

export function isDedicatedPrivateGpuProviderID(id: string) {
  return VENDORS_BY_ID.get(id)?.mode === "dedicated"
}

export function requirePrivateGpuVendor(id: string) {
  const vendor = privateGpuVendor(id)
  if (!vendor) throw new Error(`Unknown private GPU provider: ${id}`)
  return vendor
}

export function requireDedicatedPrivateGpuVendor(id: string) {
  const vendor = requirePrivateGpuVendor(id)
  if (vendor.mode !== "dedicated") throw new Error(`${vendor.name} uses an API key, not a dedicated endpoint`)
  return vendor
}
