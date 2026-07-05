export const AX_CODE_WORKSPACE_HEADER = "x-ax-code-workspace"
export const LEGACY_OPENCODE_WORKSPACE_HEADER = "x-opencode-workspace"

export function workspaceHeaderValue(readHeader: (name: string) => string | undefined): string | undefined {
  return readHeader(AX_CODE_WORKSPACE_HEADER) ?? readHeader(LEGACY_OPENCODE_WORKSPACE_HEADER)
}

export function withWorkspaceHeaders(headers: Record<string, string>, workspaceID: string) {
  headers[AX_CODE_WORKSPACE_HEADER] = workspaceID
  headers[LEGACY_OPENCODE_WORKSPACE_HEADER] = workspaceID
  return headers
}
