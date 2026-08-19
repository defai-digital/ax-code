// Provider presets shared by the server-backed setup dialog and the CLI login
// picker. Keep surface-specific entries (`ax-engine` and `ax-code`) at their
// call sites.
//
// Cloud API-key providers (google, deepseek, meta/Muse Spark, …) must stay
// here so /connect, providers login, and the Desktop setup dialog surface them
// without requiring enabled_providers opt-in — same pattern OpenCode uses for
// native deepseek + meta blocks.
import { CLI_PROVIDER_IDS } from "./cli/ids"

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
  "github-copilot",
  "zai",
  "zai-coding-plan",
  // models.dev still publishes these as *-coding-plan; MiniMax renamed the
  // product to Token Plan. Display names and docs use Token Plan.
  "minimax-coding-plan",
  "minimax-cn-coding-plan",
  ...CLI_PROVIDER_IDS,
] as const
