import http from "node:http"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket, WebSocketServer } from "ws"

import {
  createDesktopApiWsProxyPlugin,
  handleDesktopApiWsUpgrade,
  isBenignProxySocketError,
  resolveDesktopApiProxyPort,
  shouldProxyDesktopApiUpgrade,
} from "./vite-api-ws-proxy"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const listen = (server: http.Server) =>
  new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind test server"))
        return
      }
      resolve(address.port)
    })
    server.on("error", reject)
  })

const closeServer = (server?: http.Server) =>
  new Promise<void>((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.closeAllConnections?.()
    server.close(() => resolve())
  })

describe("desktop API vite websocket proxy helpers", () => {
  it("treats expected proxy disconnects as benign", () => {
    expect(isBenignProxySocketError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))).toBe(true)
    expect(isBenignProxySocketError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true)
    expect(isBenignProxySocketError(Object.assign(new Error("aborted"), { code: "ECONNABORTED" }))).toBe(true)
    expect(isBenignProxySocketError(Object.assign(new Error("refused"), { code: "ECONNREFUSED" }))).toBe(true)
    expect(isBenignProxySocketError(Object.assign(new Error("real failure"), { code: "EPERM" }))).toBe(false)
    expect(isBenignProxySocketError(new Error("no code"))).toBe(false)
    expect(isBenignProxySocketError("EPIPE")).toBe(false)
  })

  it("only proxies /api websocket upgrades", () => {
    expect(shouldProxyDesktopApiUpgrade("/api/global/event/ws")).toBe(true)
    expect(shouldProxyDesktopApiUpgrade("/api/terminal/ws?session=1")).toBe(true)
    expect(shouldProxyDesktopApiUpgrade("/api")).toBe(true)
    expect(shouldProxyDesktopApiUpgrade("/?token=hmr")).toBe(false)
    expect(shouldProxyDesktopApiUpgrade("/@vite/client")).toBe(false)
    expect(shouldProxyDesktopApiUpgrade("/auth/session")).toBe(false)
    expect(shouldProxyDesktopApiUpgrade(undefined)).toBe(false)
  })

  it("falls back to the default desktop server port", () => {
    expect(resolveDesktopApiProxyPort("65506")).toBe(65506)
    expect(resolveDesktopApiProxyPort("")).toBe(3001)
    expect(resolveDesktopApiProxyPort("nope")).toBe(3001)
  })
})

describe("desktop API vite websocket proxy", () => {
  let targetServer: http.Server | undefined
  let proxyServer: http.Server | undefined

  afterEach(async () => {
    await Promise.all([closeServer(proxyServer), closeServer(targetServer)])
    targetServer = undefined
    proxyServer = undefined
  })

  it("forwards /api websocket upgrades to the desktop server", async () => {
    const messages: string[] = []
    targetServer = http.createServer()
    const targetWs = new WebSocketServer({ noServer: true })
    targetServer.on("upgrade", (req, socket, head) => {
      expect(req.url).toBe("/api/global/event/ws")
      targetWs.handleUpgrade(req, socket, head, (ws) => {
        ws.on("message", (data) => {
          messages.push(String(data))
          ws.send(`echo:${String(data)}`)
        })
      })
    })
    const targetPort = await listen(targetServer)

    proxyServer = http.createServer()
    proxyServer.on("upgrade", (req, socket, head) => {
      handleDesktopApiWsUpgrade(req, socket, head, targetPort)
    })
    const proxyPort = await listen(proxyServer)

    const client = new WebSocket(`ws://127.0.0.1:${proxyPort}/api/global/event/ws`)
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve())
      client.once("error", reject)
    })

    const reply = await new Promise<string>((resolve, reject) => {
      client.once("message", (data) => resolve(String(data)))
      client.once("error", reject)
      client.send("ping")
    })
    expect(reply).toBe("echo:ping")
    expect(messages).toEqual(["ping"])

    client.close()
    targetWs.close()
  })

  it("does not throw when the renderer closes the socket during the handshake", async () => {
    const uncaught: unknown[] = []
    const onUncaught = (error: unknown) => {
      uncaught.push(error)
    }
    process.on("uncaughtException", onUncaught)

    targetServer = http.createServer()
    const targetWs = new WebSocketServer({ noServer: true })
    targetServer.on("upgrade", (req, socket, head) => {
      targetWs.handleUpgrade(req, socket, head, () => {})
    })
    const targetPort = await listen(targetServer)

    proxyServer = http.createServer()
    proxyServer.on("upgrade", (req, socket, head) => {
      handleDesktopApiWsUpgrade(req, socket, head, targetPort)
    })
    const proxyPort = await listen(proxyServer)

    const client = new WebSocket(`ws://127.0.0.1:${proxyPort}/api/global/event/ws`)
    client.on("error", () => {})
    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve())
      client.once("error", reject)
    })
    client.terminate()

    await new Promise((resolve) => setTimeout(resolve, 50))
    process.off("uncaughtException", onUncaught)
    expect(uncaught).toEqual([])

    targetWs.close()
  })

  it("ignores vite HMR upgrades so they stay on the vite server", () => {
    const handled = handleDesktopApiWsUpgrade(
      { url: "/?token=hmr", headers: {}, method: "GET" } as http.IncomingMessage,
      { on() {}, destroyed: false, destroy() {} } as never,
      Buffer.alloc(0),
      3001,
    )
    expect(handled).toBe(false)
  })

  it("exports a vite plugin that hooks the HTTP upgrade path", () => {
    const plugin = createDesktopApiWsProxyPlugin()
    expect(plugin.name).toBe("desktop-api-ws-proxy")
    expect(typeof plugin.configureServer).toBe("function")
  })
})

describe("vite.config desktop websocket proxy wiring", () => {
  it("uses the dedicated /api websocket proxy instead of vite ws: true", async () => {
    const source = await readFile(path.join(__dirname, "vite.config.ts"), "utf8")
    expect(source).toContain("createDesktopApiWsProxyPlugin")
    expect(source).not.toMatch(/ws:\s*true/)
  })
})
