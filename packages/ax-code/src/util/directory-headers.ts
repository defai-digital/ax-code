export const AX_CODE_DIRECTORY_HEADER = "x-ax-code-directory"
export const LEGACY_OPENCODE_DIRECTORY_HEADER = "x-opencode-directory"

export function encodeDirectoryHeader(directory: string) {
  return /[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory
}

export function requestHeadersToRecord(headers: RequestInit["headers"] | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

export function withDirectoryHeaders(headers: Record<string, string>, directory: string) {
  const encodedDirectory = encodeDirectoryHeader(directory)
  headers[AX_CODE_DIRECTORY_HEADER] = encodedDirectory
  headers[LEGACY_OPENCODE_DIRECTORY_HEADER] = encodedDirectory
  return headers
}
