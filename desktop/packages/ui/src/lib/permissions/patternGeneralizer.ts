import type { PermissionRequest } from "@/types/permission"

const getMetaString = (metadata: Record<string, unknown>, key: string): string => {
  const val = metadata[key]
  return typeof val === "string" ? val : ""
}

export const generalizeCommandPattern = (command: string): string => {
  const parts = command.trim().split(/\s+/)
  if (parts.length === 0) return "*"

  const binary = parts[0]
  const firstSubcommand = parts.length > 1 ? parts[1] : undefined

  if (firstSubcommand && /^[a-zA-Z0-9_-]+$/.test(firstSubcommand) && !firstSubcommand.startsWith("-")) {
    return `${binary} ${firstSubcommand} *`
  }

  return `${binary} *`
}

export const generalizePathPattern = (filePath: string): string => {
  if (!filePath) return "*"

  const segments = filePath.split("/")
  if (segments.length <= 2) return filePath

  const dirSegments = segments.slice(0, -1)
  return `${dirSegments.join("/")}/*`
}

export const generalizeUrlPattern = (url: string): string => {
  if (!url) return "*"

  try {
    const parsed = new URL(url)
    const base = `${parsed.protocol}//${parsed.host}`
    const pathParts = parsed.pathname.split("/").filter(Boolean)
    if (pathParts.length <= 1) return url
    const prefix = pathParts.slice(0, 1).join("/")
    return `${base}/${prefix}/*`
  } catch {
    return "*"
  }
}

export const suggestAllowPattern = (permission: PermissionRequest): string[] => {
  const tool = permission.permission.toLowerCase()
  const serverAlways = permission.always ?? []

  if (serverAlways.length > 0) return serverAlways

  const suggestions: string[] = []

  if (tool === "bash" || tool === "shell" || tool === "shell_command") {
    const command =
      getMetaString(permission.metadata, "command") ||
      getMetaString(permission.metadata, "cmd") ||
      getMetaString(permission.metadata, "script")
    if (command) {
      suggestions.push(generalizeCommandPattern(command))
    }
    suggestions.push("bash *")
  } else if (tool === "edit" || tool === "multiedit" || tool === "str_replace") {
    const filePath =
      getMetaString(permission.metadata, "path") ||
      getMetaString(permission.metadata, "file_path") ||
      getMetaString(permission.metadata, "filePath")
    if (filePath) {
      suggestions.push(`edit ${generalizePathPattern(filePath)}`)
    }
    suggestions.push("edit *")
  } else if (tool === "write" || tool === "create") {
    const filePath =
      getMetaString(permission.metadata, "path") ||
      getMetaString(permission.metadata, "file_path") ||
      getMetaString(permission.metadata, "filePath")
    if (filePath) {
      suggestions.push(`write ${generalizePathPattern(filePath)}`)
    }
    suggestions.push("write *")
  } else if (tool === "webfetch" || tool === "fetch") {
    const url = getMetaString(permission.metadata, "url") || getMetaString(permission.metadata, "uri")
    if (url) {
      suggestions.push(`webfetch ${generalizeUrlPattern(url)}`)
    }
    suggestions.push("webfetch *")
  }

  if (suggestions.length === 0) {
    suggestions.push(`${permission.permission} *`)
  }

  return suggestions
}
