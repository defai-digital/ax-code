import { AX_CODE_INTERNAL_ORIGIN } from "@/constants/network"

export const TUI_INTERNAL_ORIGIN = AX_CODE_INTERNAL_ORIGIN
export const AX_CODE_DIRECTORY_HEADER = "x-ax-code-directory"
export const LEGACY_OPENCODE_DIRECTORY_HEADER = "x-opencode-directory"
export const AX_CODE_ROUTE_ENV = "AX_CODE_ROUTE"
export const LEGACY_OPENCODE_ROUTE_ENV = "OPENCODE_ROUTE"

export function encodeTuiDirectory(directory: string) {
  return /[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory
}

export function applyTuiDirectoryHeaders(headers: Record<string, string>, directory?: string) {
  if (!directory) return

  const encoded = encodeTuiDirectory(directory)
  headers[AX_CODE_DIRECTORY_HEADER] = encoded
  // Keep the legacy header during the AX Code transition because older
  // server peers still read it as a fallback.
  headers[LEGACY_OPENCODE_DIRECTORY_HEADER] = encoded
}

export function readTuiRouteEnv(env: NodeJS.ProcessEnv = process.env) {
  return env[AX_CODE_ROUTE_ENV] || env[LEGACY_OPENCODE_ROUTE_ENV]
}
