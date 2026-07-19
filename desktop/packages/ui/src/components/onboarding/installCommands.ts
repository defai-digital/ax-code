import type { OnboardingPlatform } from "./types"

/** Official docs / install landing for Desktop onboarding. */
export const AX_CODE_INSTALL_DOCS_URL =
  "https://github.com/defai-digital/ax-code/blob/main/docs/getting-started/install-runtime.md"

export const MACOS_INSTALL_COMMAND =
  "brew tap defai-digital/ax-code && brew install defai-digital/ax-code/ax-code"

export const LINUX_INSTALL_COMMAND =
  "curl -fsSL https://github.com/defai-digital/ax-code/releases/latest/download/install | bash"

export const WINDOWS_INSTALL_COMMAND =
  "irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 | iex"

export type InstallCommandHighlight =
  | { kind: "keyword"; text: string }
  | { kind: "string"; text: string }
  | { kind: "muted"; text: string }

/**
 * Return the recommended one-line CLI install command for the host platform.
 * Windows uses the native PowerShell installer (not WSL-only).
 */
export function getInstallCommand(platform: OnboardingPlatform): string {
  switch (platform) {
    case "windows":
      return WINDOWS_INSTALL_COMMAND
    case "macos":
      return MACOS_INSTALL_COMMAND
    case "linux":
      return LINUX_INSTALL_COMMAND
    default:
      return LINUX_INSTALL_COMMAND
  }
}

/**
 * Tokenize install commands for monospaced syntax highlighting in the UI.
 */
export function getInstallCommandHighlights(platform: OnboardingPlatform): InstallCommandHighlight[] {
  switch (platform) {
    case "windows":
      return [
        { kind: "keyword", text: "irm" },
        { kind: "muted", text: " " },
        {
          kind: "string",
          text: "https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1",
        },
        { kind: "muted", text: " | " },
        { kind: "keyword", text: "iex" },
      ]
    case "macos":
      return [
        { kind: "keyword", text: "brew" },
        { kind: "muted", text: " tap " },
        { kind: "string", text: "defai-digital/ax-code" },
        { kind: "muted", text: " && " },
        { kind: "keyword", text: "brew" },
        { kind: "muted", text: " install " },
        { kind: "string", text: "defai-digital/ax-code/ax-code" },
      ]
    case "linux":
    default:
      return [
        { kind: "keyword", text: "curl" },
        { kind: "muted", text: " -fsSL " },
        {
          kind: "string",
          text: "https://github.com/defai-digital/ax-code/releases/latest/download/install",
        },
        { kind: "muted", text: " | " },
        { kind: "keyword", text: "bash" },
      ]
  }
}

export function getBinaryPathPlaceholder(platform: OnboardingPlatform): string {
  switch (platform) {
    case "windows":
      return "C:\\Users\\you\\.ax-code\\bin\\ax-code.cmd"
    case "linux":
      return "/home/you/.ax-code/bin/ax-code"
    case "macos":
      return "/opt/homebrew/bin/ax-code"
    default:
      return "/Users/you/.ax-code/bin/ax-code"
  }
}

export function getInstallDocsUrl(_platform: OnboardingPlatform): string {
  return AX_CODE_INSTALL_DOCS_URL
}
