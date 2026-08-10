// Provider presets shared by the server-backed setup dialog and the CLI login
// picker. Keep surface-specific entries (`ax-engine` and `ax-code`) at their
// call sites.
//
// Cloud API-key providers (google, deepseek, meta/Muse Spark, …) must stay
// here so /connect, providers login, and the Desktop setup dialog surface them
// without requiring enabled_providers opt-in — same pattern OpenCode uses for
// native deepseek + meta blocks.
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
  "github-copilot",
  "zai-coding-plan",
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "qoder-cli",
  "antigravity-cli",
  "kimi-cli",
] as const
