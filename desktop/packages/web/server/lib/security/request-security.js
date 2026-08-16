import { normalizeLoopbackHttpOrigin } from "./local-only.js"

export const createRequestSecurityRuntime = () => {
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

  const isRequestOriginAllowed = async (req) => {
    const originHeader = asTrimmedString(req.headers.origin)
    // Non-browser clients (curl, Electron main, the node SDK) send no Origin
    // header. Browsers always send one on cross-site requests and WebSocket
    // upgrades, so an absent Origin cannot be a cross-site browser attack.
    if (!originHeader) {
      return true
    }

    // The UI is served same-origin from this loopback server, and the Vite
    // dev proxy forwards the browser's original (loopback) Origin while
    // rewriting Host — so accept any loopback origin rather than requiring an
    // exact host match. What must be rejected is a cross-site (non-loopback)
    // browser origin: any website open in the user's browser can otherwise
    // reach this loopback server.
    return normalizeLoopbackHttpOrigin(originHeader) !== null
  }

  return {
    getUiSessionTokenFromRequest,
    rejectWebSocketUpgrade,
    isRequestOriginAllowed,
  }
}
