export const AX_CODE_DIRECTORY_HEADER = "x-ax-code-directory"
export const AX_CODE_WORKSPACE_HEADER = "x-ax-code-workspace"
export const LEGACY_OPENCODE_DIRECTORY_HEADER = "x-opencode-directory"
export const LEGACY_OPENCODE_WORKSPACE_HEADER = "x-opencode-workspace"

function encodeDirectoryHeader(directory: string) {
  return /[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory
}

export function withDirectoryHeaders(headers: Record<string, string> | undefined, directory: string) {
  const encodedDirectory = encodeDirectoryHeader(directory)
  return {
    ...headers,
    [AX_CODE_DIRECTORY_HEADER]: encodedDirectory,
    [LEGACY_OPENCODE_DIRECTORY_HEADER]: encodedDirectory,
  }
}

export function withWorkspaceHeaders(headers: Record<string, string> | undefined, workspaceID: string) {
  return {
    ...headers,
    [AX_CODE_WORKSPACE_HEADER]: workspaceID,
    [LEGACY_OPENCODE_WORKSPACE_HEADER]: workspaceID,
  }
}
