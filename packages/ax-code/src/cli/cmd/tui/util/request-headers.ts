import { withDirectoryHeaders } from "@/util/directory-headers"

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

  return withDirectoryHeaders(headers, input.directory)
}
