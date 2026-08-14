import http from "node:http"
import type { IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import type { Plugin } from "vite"

const BENIGN_PROXY_SOCKET_CODES = new Set(["EPIPE", "ECONNRESET", "ECONNABORTED", "ECONNREFUSED"])

export function isBenignProxySocketError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = "code" in error ? error.code : undefined
  return typeof code === "string" && BENIGN_PROXY_SOCKET_CODES.has(code)
}

export function shouldProxyDesktopApiUpgrade(url: string | undefined): boolean {
  if (typeof url !== "string" || url.length === 0) return false

  try {
    const pathname = new URL(url, "http://127.0.0.1").pathname
    return pathname === "/api" || pathname.startsWith("/api/")
  } catch {
    return url === "/api" || url.startsWith("/api/")
  }
}

export function resolveDesktopApiProxyPort(rawPort = process.env.AX_CODE_DESKTOP_PORT): number {
  const parsed = Number.parseInt(typeof rawPort === "string" ? rawPort : "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3001
}

function attachBenignSocketErrorHandler(socket: Socket) {
  socket.on("error", (error) => {
    if (isBenignProxySocketError(error)) return
    console.error("[vite] api ws proxy socket error:", error)
  })
}

function writeHttpHead(socket: Socket, statusCode: number, statusMessage: string, headers: IncomingMessage["headers"]) {
  let payload = `HTTP/1.1 ${statusCode} ${statusMessage}\r\n`
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue
    payload += `${key}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`
  }
  payload += "\r\n"
  socket.write(payload)
}

export function handleDesktopApiWsUpgrade(
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  targetPort = resolveDesktopApiProxyPort(),
) {
  if (!shouldProxyDesktopApiUpgrade(req.url)) return false

  attachBenignSocketErrorHandler(socket)

  const proxyReq = http.request({
    hostname: "127.0.0.1",
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${targetPort}`,
    },
  })

  const destroyBoth = () => {
    if (!socket.destroyed) socket.destroy()
    proxyReq.destroy()
  }

  proxyReq.on("error", (error) => {
    if (!isBenignProxySocketError(error)) {
      console.error("[vite] api ws proxy error:", error)
    }
    destroyBoth()
  })

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    proxySocket.pause()
    attachBenignSocketErrorHandler(proxySocket)

    if (socket.destroyed) {
      proxySocket.destroy()
      return
    }

    try {
      writeHttpHead(socket, 101, "Switching Protocols", proxyRes.headers)
      if (head.length > 0) proxySocket.write(head)
      if (proxyHead.length > 0) socket.write(proxyHead)
    } catch (error) {
      if (!isBenignProxySocketError(error)) {
        console.error("[vite] api ws proxy error:", error)
      }
      proxySocket.destroy()
      destroyBoth()
      return
    }

    proxySocket.pipe(socket)
    socket.pipe(proxySocket)
    proxySocket.resume()
  })

  proxyReq.on("response", (res) => {
    if (socket.destroyed) {
      res.destroy()
      return
    }

    try {
      writeHttpHead(socket, res.statusCode ?? 502, res.statusMessage || "Bad Gateway", res.headers)
    } catch (error) {
      if (!isBenignProxySocketError(error)) {
        console.error("[vite] api ws proxy error:", error)
      }
      res.destroy()
      destroyBoth()
      return
    }

    res.pipe(socket)
  })

  proxyReq.end()
  return true
}

export function createDesktopApiWsProxyPlugin(): Plugin {
  const targetPort = resolveDesktopApiProxyPort()

  return {
    name: "desktop-api-ws-proxy",
    configureServer(server) {
      server.httpServer?.on("upgrade", (req, socket, head) => {
        handleDesktopApiWsUpgrade(req, socket, head, targetPort)
      })
    },
  }
}
