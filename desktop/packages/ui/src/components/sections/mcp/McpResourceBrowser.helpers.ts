import type { McpReadResourceResult, McpResource } from "@ax-code/sdk/v2"

const MAX_PREVIEW_CHARS = 12_000

export type ResourcePreview = {
  text: string
  truncated: boolean
  binaryOnly: boolean
}

export function resourcesForServer(resources: Record<string, McpResource>, serverName: string): McpResource[] {
  return Object.values(resources)
    .filter((resource) => resource.client === serverName)
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name)
      return byName === 0 ? a.uri.localeCompare(b.uri) : byName
    })
}

export function resourcePreview(result: McpReadResourceResult, binaryLabel: (mime: string) => string): ResourcePreview {
  const textParts: string[] = []
  const binaryParts: string[] = []

  for (const content of result.contents) {
    if ("text" in content && typeof content.text === "string") {
      textParts.push(content.text)
      continue
    }
    if ("blob" in content && typeof content.blob === "string") {
      binaryParts.push(binaryLabel(content.mimeType ?? "application/octet-stream"))
    }
  }

  const fullText = textParts.length > 0 ? textParts.join("\n\n") : binaryParts.join("\n")
  if (fullText.length <= MAX_PREVIEW_CHARS) {
    return { text: fullText, truncated: false, binaryOnly: textParts.length === 0 && binaryParts.length > 0 }
  }

  return {
    text: fullText.slice(0, MAX_PREVIEW_CHARS),
    truncated: true,
    binaryOnly: textParts.length === 0 && binaryParts.length > 0,
  }
}
