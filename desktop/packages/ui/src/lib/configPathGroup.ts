interface ConfigPathGroupOptions {
  segment: string
  minimumPartsForGroup: number
}

export const parseConfigPathGroup = (
  path: string | null | undefined,
  options: ConfigPathGroupOptions,
): string | undefined => {
  if (!path) return undefined
  const normalizedPath = path.replace(/\\/g, "/")
  const marker = `/${options.segment}/`
  const idx = normalizedPath.lastIndexOf(marker)
  if (idx === -1) return undefined
  const relative = normalizedPath.substring(idx + marker.length)
  const parts = relative.split("/")
  return parts.length >= options.minimumPartsForGroup ? parts[0] : undefined
}
