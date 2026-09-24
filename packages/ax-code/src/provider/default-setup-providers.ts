// Provider presets shared by the server-backed setup dialog and the CLI login
// picker. Keep surface-specific entries (`ax-engine` and `ax-code`) at their
// call sites.
//
// Cloud API-key providers (google, deepseek, meta/Muse Spark, …) must stay
// here so /connect, providers login, and the Desktop setup dialog surface them
// without requiring enabled_providers opt-in — same pattern OpenCode uses for
// native deepseek + meta blocks.
import { CLI_PROVIDER_IDS } from "./cli/ids"
import { LOCAL_LLM_PROVIDER_IDS } from "@/mode/provider-category"
import { isPrivateGpuProviderID } from "./private-gpu/presets"
import { AX_ENGINE_PROVIDER_ID } from "./ax-engine/constants"
import type { ModelsDev } from "./models"

export const DEFAULT_SETUP_PROVIDER_IDS = [
  "google",
  "deepseek",
  "meta",
  "groq",
  "openrouter",
  "huggingface",
  "unorouter",
  "alibaba-coding-plan",
  "alibaba-coding-plan-cn",
  "alibaba-token-plan",
  "alibaba-token-plan-cn",
  // Private GPU cloud — catalog (OpenCode / models.dev API-key vendors)
  "nebius",
  "fireworks-ai",
  "togetherai",
  "baseten",
  "nvidia",
  "deepinfra",
  // Private GPU cloud — dedicated URL + token + /models discover
  "alibaba-pai",
  "runpod",
  "huggingface-endpoints",
  "sagemaker",
  "volcengine-ark",
  "modelarts",
  "tencent-ti",
  "custom-private-gpu",
  "github-copilot",
  "zai",
  "zai-coding-plan",
  // models.dev still publishes these as *-coding-plan; MiniMax renamed the
  // product to Token Plan. Display names and docs use Token Plan.
  "minimax-coding-plan",
  "minimax-cn-coding-plan",
  ...CLI_PROVIDER_IDS,
] as const

const CLI_PROVIDER_ID_SET = new Set<string>(CLI_PROVIDER_IDS)
const LOCAL_LLM_PROVIDER_ID_SET = new Set<string>(LOCAL_LLM_PROVIDER_IDS)

/**
 * Whether a models.dev catalog record belongs on the /connect API Cloud
 * Provider list beyond the curated suggested set: at least one model, not a
 * CLI adapter, and not owned by another connect category (local runtime,
 * private GPU cloud, AX Engine). Records with zero models (e.g. snapshot
 * placeholders for local runtimes) stay on their own category paths.
 */
export function isApiCloudCatalogProvider(id: string, provider: ModelsDev.Provider): boolean {
  if (id === AX_ENGINE_PROVIDER_ID) return false
  if (CLI_PROVIDER_ID_SET.has(id)) return false
  if (LOCAL_LLM_PROVIDER_ID_SET.has(id)) return false
  if (isPrivateGpuProviderID(id)) return false
  if (provider.npm === "cli") return false
  return Object.keys(provider.models).length > 0
}
