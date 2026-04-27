export function directoryRequestHeaders(
  input: {
    directory?: string
    accept?: string
    contentType?: string
  } = {},
) {
  const headers: Record<string, string> = {}

  if (input.accept) headers.accept = input.accept
  if (input.contentType) headers["content-type"] = input.contentType
  if (!input.directory) return headers

  const encoded = /[^\x00-\x7F]/.test(input.directory) ? encodeURIComponent(input.directory) : input.directory
  headers["x-ax-code-directory"] = encoded
  headers["x-opencode-directory"] = encoded
  return headers
}
