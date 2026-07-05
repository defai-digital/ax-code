const titleCaseTokens = (tokens) => tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(" ")
const asTrimmedString = (value) => (typeof value === "string" ? value.trim() : "")

const formatNotificationTokenLabel = (value, separatorPattern, fallback) => {
  const normalized = asTrimmedString(value)
  if (!normalized) return fallback
  return titleCaseTokens(normalized.split(separatorPattern).filter(Boolean))
}

export const formatNotificationProjectLabel = (label) => {
  if (!label || typeof label !== "string") return ""
  return formatNotificationTokenLabel(label, /[-_]/g, "")
}

export const formatNotificationModeLabel = (raw) => {
  const value = asTrimmedString(raw)
  return formatNotificationTokenLabel(value.length > 0 ? value : "agent", /[-_\s]+/, "Agent")
}

export const formatNotificationModelLabel = (raw) => {
  const value = asTrimmedString(raw)
  if (!value) return "Assistant"

  const tokens = value.split(/[-_]+/).filter(Boolean)
  const result = []
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index]
    const next = tokens[index + 1]
    if (/^\d+$/.test(current) && next && /^\d+$/.test(next)) {
      result.push(`${current}.${next}`)
      index += 1
      continue
    }
    result.push(current)
  }

  return titleCaseTokens(result)
}
