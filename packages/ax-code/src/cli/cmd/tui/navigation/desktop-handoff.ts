// Desktop handoff logic for TUI (ADR-035).
// Guides users toward AX Code Desktop for rich dashboard and workflow
// supervision features. Keep free of solid/opentui imports.

export type DesktopHandoffResult =
  | { type: "message"; message: string }
  | { type: "not-installed"; message: string }
  | { type: "unsupported"; message: string }

export type DesktopHandoffInput = {
  platform: NodeJS.Platform
  desktopUrl?: string
}

// Platforms where AX Code Desktop is available
const SUPPORTED_PLATFORMS: NodeJS.Platform[] = ["darwin", "win32"]

// Documentation URL for desktop installation
const DESKTOP_DOCS_URL = "https://github.com/automatos-ai/ax-code#desktop"

/**
 * Resolve the desktop handoff result.
 *
 * Priority:
 * 1. If desktopUrl is provided — show the URL to open
 * 2. If platform is unsupported — explain unsupported platform
 * 3. Otherwise — guide to installation docs
 *
 * This is a message-only implementation. Platform opener (auto-launch)
 * should be added only after safe command behavior is validated.
 */
export function resolveDesktopHandoff(input: DesktopHandoffInput): DesktopHandoffResult {
  // If a desktop URL is configured, show it for manual opening
  if (input.desktopUrl) {
    return {
      type: "message",
      message: `Open AX Code Desktop at: ${input.desktopUrl}`,
    }
  }

  // Check platform support
  if (!SUPPORTED_PLATFORMS.includes(input.platform)) {
    return {
      type: "unsupported",
      message: `AX Code Desktop is not yet available for ${input.platform}. Dashboards and workflow supervision are recommended in desktop mode when available.`,
    }
  }

  // Guide to installation
  return {
    type: "not-installed",
    message: `AX Code Desktop is recommended for dashboards, workflow supervision, and project overview. Visit ${DESKTOP_DOCS_URL} to install.`,
  }
}

// Exported for testing
export const __internal = {
  DESKTOP_DOCS_URL,
  SUPPORTED_PLATFORMS,
}
