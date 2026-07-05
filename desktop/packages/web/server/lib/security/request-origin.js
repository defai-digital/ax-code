const asTrimmedString = (value) => (typeof value === "string" ? value.trim() : "")

export const firstForwardedHeaderValue = (value) =>
  typeof value === "string" ? asTrimmedString(value.split(",")[0]) : ""

export const getRequestProtocol = (req) => {
  const forwardedProto = firstForwardedHeaderValue(req?.headers?.["x-forwarded-proto"]).toLowerCase()
  return forwardedProto || (req?.socket?.encrypted ? "https" : "http")
}

export const getRequestHost = (req) => {
  return firstForwardedHeaderValue(req?.headers?.["x-forwarded-host"]) || firstForwardedHeaderValue(req?.headers?.host)
}

export const getRequestOrigin = (req) => {
  const host = getRequestHost(req)
  if (!host) return ""

  try {
    return new URL(`${getRequestProtocol(req)}://${host}`).origin
  } catch {
    return ""
  }
}

export const getRequestRpId = (req) => {
  const host = getRequestHost(req) || asTrimmedString(req?.hostname)
  if (!host) return ""

  if (host.startsWith("[")) {
    const end = host.indexOf("]")
    return end >= 0 ? host.slice(1, end).toLowerCase() : host.toLowerCase()
  }

  const colonIndex = host.indexOf(":")
  return (colonIndex >= 0 ? host.slice(0, colonIndex) : host).toLowerCase()
}

export const addLocalhostOriginAliases = (origins, origin) => {
  let parsed = null
  try {
    parsed = new URL(origin)
  } catch {
    return
  }

  const normalizedHost = parsed.hostname.toLowerCase()
  const portSuffix = parsed.port ? `:${parsed.port}` : ""
  if (normalizedHost === "localhost") {
    origins.add(`${parsed.protocol}//127.0.0.1${portSuffix}`)
    origins.add(`${parsed.protocol}//[::1]${portSuffix}`)
  } else if (normalizedHost === "127.0.0.1" || normalizedHost === "[::1]" || normalizedHost === "::1") {
    origins.add(`${parsed.protocol}//localhost${portSuffix}`)
  }
}
