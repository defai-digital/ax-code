// Provider presets shared by the server-backed setup dialog and the CLI login
// picker. Keep surface-specific entries (`ax-engine` and `ax-code`) at their
// call sites.
export const DEFAULT_SETUP_PROVIDER_IDS = [
  "google",
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
