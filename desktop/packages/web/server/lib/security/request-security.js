import { addLocalhostOriginAliases, getRequestOrigin } from "./request-origin.js"

export const createRequestSecurityRuntime = (deps) => {
  const { readSettingsFromDiskMigrated } = deps
  const asTrimmedString = (value) => (typeof value === "string" ? value.trim() : "")

  const getUiSessionTokenFromRequest = (req) => {
    const cookieHeader = req?.headers?.cookie
    if (!cookieHeader || typeof cookieHeader !== "string") {
      return null
    }
    const segments = cookieHeader.split(";")
    for (const segment of segments) {
      const [rawName, ...rest] = segment.split("=")
      const name = rawName?.trim()
      if (!name) continue
      if (name !== "oc_ui_session") continue
      const value = rest.join("=").trim()
      try {
        return decodeURIComponent(value || "")
      } catch {
        return value || null
      }
    }
    return null
  }

  const rejectWebSocketUpgrade = (socket, statusCode, reason) => {
    if (!socket || socket.destroyed) {
      return
    }

    const message = asTrimmedString(reason) || "Bad Request"
    const body = Buffer.from(message, "utf8")
    const statusText =
      {
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        500: "Internal Server Error",
      }[statusCode] || "Bad Request"

    try {
      socket.write(
        `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
          "Connection: close\r\n" +
          "Content-Type: text/plain; charset=utf-8\r\n" +
          `Content-Length: ${body.length}\r\n\r\n`,
      )
      socket.write(body)
    } catch {}

    try {
      socket.destroy()
    } catch {}
  }

  const getRequestOriginCandidates = async (req) => {
    const origins = new Set()
    const origin = getRequestOrigin(req)
    if (origin) {
      origins.add(origin)
      addLocalhostOriginAliases(origins, origin)
    }

    try {
      const settings = await readSettingsFromDiskMigrated()
      const publicOrigin = asTrimmedString(settings?.publicOrigin)
      if (publicOrigin) {
        origins.add(new URL(publicOrigin).origin)
      }
    } catch {}

    return origins
  }

  const isRequestOriginAllowed = async (req) => {
    const originHeader = asTrimmedString(req.headers.origin)
    if (!originHeader) {
      return false
    }

    let normalizedOrigin = ""
    try {
      normalizedOrigin = new URL(originHeader).origin
    } catch {
      return false
    }

    const allowedOrigins = await getRequestOriginCandidates(req)
    return allowedOrigins.has(normalizedOrigin)
  }

  return {
    getUiSessionTokenFromRequest,
    rejectWebSocketUpgrade,
    isRequestOriginAllowed,
  }
}
