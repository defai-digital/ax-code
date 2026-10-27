import http from "node:http"
import net from "node:net"
import { afterEach, describe, expect, test } from "vitest"
import { EgressProxy } from "../../src/isolation/egress-proxy"
type Handle = EgressProxy.Handle
const { isAllowed, isPrivateAddress, normalizeHost, proxyEnv } = EgressProxy

const activeHandles: Handle[] = []
const activeServers: (http.Server | net.Server)[] = []

afterEach(async () => {
  await Promise.all(activeHandles.splice(0).map((handle) => handle.stop()))
  await Promise.all(
    activeServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          const closable = server as http.Server
          closable.closeAllConnections?.()
          server.close(() => resolve())
        }),
    ),
  )
})

/** Loopback sockets are EPERM in the agent sandbox; skip cleanly when so. */
function socketBlocked(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM"
}

function startServer(server: http.Server | net.Server, port = 0): Promise<number> {
  activeServers.push(server)
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("server did not bind a loopback port"))
        return
      }
      resolve(address.port)
    })
  })
}

describe("egress proxy host matching", () => {
  test("normalizes case and a trailing root dot", () => {
    expect(normalizeHost("Example.COM.")).toBe("example.com")
    expect(normalizeHost("  api.Example.com  ")).toBe("api.example.com")
  })

  test("allows exact hosts and wildcard suffixes", () => {
    const config = { allowedDomains: ["registry.npmjs.org", "*.github.com"] }
    expect(isAllowed("registry.npmjs.org", config)).toBe(true)
    expect(isAllowed("api.github.com", config)).toBe(true)
    expect(isAllowed("github.com", config)).toBe(true)
    expect(isAllowed("sub.api.github.com", config)).toBe(true)
    expect(isAllowed("evilgithub.com", config)).toBe(false)
    expect(isAllowed("github.com.evil.test", config)).toBe(false)
  })

  test("denied domains win over an allowlisted match", () => {
    const config = { allowedDomains: ["*.example.com"], deniedDomains: ["secret.example.com"] }
    expect(isAllowed("public.example.com", config)).toBe(true)
    expect(isAllowed("secret.example.com", config)).toBe(false)
  })

  test("an empty host is never allowed", () => {
    expect(isAllowed("", { allowedDomains: ["*"] })).toBe(false)
    expect(isAllowed("   ", { allowedDomains: ["*.example.com"] })).toBe(false)
  })
})

describe("egress proxy target classification", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.5",
  ])("refuses private/loopback/link-local target %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  test.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])("permits public target %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false)
  })
})

describe("egress proxy environment", () => {
  test("points every proxy variable at the loopback port and keeps loopback out of the proxy", () => {
    const env = proxyEnv(4242)
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:4242")
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:4242")
    expect(env.ALL_PROXY).toBe("http://127.0.0.1:4242")
    expect(env.http_proxy).toBe("http://127.0.0.1:4242")
    expect(env.NO_PROXY).toContain("127.0.0.1")
    expect(env.no_proxy).toContain("localhost")
  })
})

describe("egress proxy transport", () => {
  // Real loopback sockets. They skip cleanly where the environment forbids
  // listening (EPERM), but run for real everywhere else.
  const loopbackLookup: NonNullable<Parameters<typeof EgressProxy.start>[0]["lookup"]> = (_host, done) =>
    done(null, "127.0.0.1", 4)
  const allowLoopback = () => false

  async function viaProxy(proxyPort: number, targetUrl: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: proxyPort,
          method: "GET",
          path: targetUrl,
          headers: { host: new URL(targetUrl).host },
        },
        (res) => {
          let body = ""
          res.on("data", (chunk) => (body += chunk))
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }))
        },
      )
      req.on("error", reject)
      req.end()
    })
  }

  async function connectVia(proxyPort: number, target: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port: proxyPort }, () => {
        socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)
      })
      socket.once("data", (chunk) => {
        resolve(chunk.toString().split("\r\n")[0] ?? "")
        socket.destroy()
      })
      socket.on("close", () => resolve("closed"))
      socket.on("error", reject)
    })
  }

  async function startOrSkip(input: Parameters<typeof EgressProxy.start>[0]) {
    try {
      const handle = await EgressProxy.start(input)
      activeHandles.push(handle)
      return handle
    } catch (error) {
      if (socketBlocked(error)) return undefined
      throw error
    }
  }

  test("rejects a relative request URI", async () => {
    const handle = await startOrSkip({ allowedDomains: ["allowed.test"] })
    if (!handle) return
    const response = await fetch(`http://127.0.0.1:${handle.port}/`).catch((error: unknown) => {
      if (socketBlocked(error)) return undefined
      throw error
    })
    if (!response) return
    expect(response.status).toBe(400)
  })

  test("forwards an allowlisted host to the real upstream", async () => {
    let upstreamPort: number
    try {
      upstreamPort = await startServer(
        http.createServer((req, res) => {
          res.writeHead(200, { "content-type": "text/plain" })
          res.end(`upstream-ok:${req.url}`)
        }),
      )
    } catch (error) {
      if (socketBlocked(error)) return
      throw error
    }
    const handle = await startOrSkip({
      allowedDomains: ["allowed.test"],
      lookup: loopbackLookup,
      isPrivate: allowLoopback,
    })
    if (!handle) return
    const result = await viaProxy(handle.port, `http://allowed.test:${upstreamPort}/path?q=1`)
    expect(result.status).toBe(200)
    expect(result.body).toBe("upstream-ok:/path?q=1")
    expect(handle.denials()).toBe(0)
  })

  test("denies a host that is not on the allowlist and counts the denial", async () => {
    const handle = await startOrSkip({
      allowedDomains: ["allowed.test"],
      lookup: loopbackLookup,
      isPrivate: allowLoopback,
    })
    if (!handle) return
    const result = await viaProxy(handle.port, "http://other.test:9/")
    expect(result.status).toBe(403)
    expect(handle.denials()).toBe(1)
  })

  test("denied domains win over an allowlisted wildcard", async () => {
    const handle = await startOrSkip({
      allowedDomains: ["*.example.test"],
      deniedDomains: ["bad.example.test"],
      lookup: loopbackLookup,
      isPrivate: allowLoopback,
    })
    if (!handle) return
    const result = await viaProxy(handle.port, "http://bad.example.test:9/")
    expect(result.status).toBe(403)
  })

  test("refuses an allowlisted host that resolves to a private address", async () => {
    const handle = await startOrSkip({ allowedDomains: ["allowed.test"], lookup: loopbackLookup })
    if (!handle) return
    const result = await viaProxy(handle.port, "http://allowed.test:9/")
    expect(result.status).toBe(403)
    expect(result.body).toContain("private address")
  })

  test("CONNECT is allowed for an allowlisted host and refused otherwise", async () => {
    let upstreamPort: number
    try {
      upstreamPort = await startServer(
        http.createServer((_req, res) => {
          res.end("x")
        }),
      )
    } catch (error) {
      if (socketBlocked(error)) return
      throw error
    }
    const handle = await startOrSkip({
      allowedDomains: ["allowed.test"],
      lookup: loopbackLookup,
      isPrivate: allowLoopback,
    })
    if (!handle) return
    expect(await connectVia(handle.port, `allowed.test:${upstreamPort}`)).toContain("200")
    expect(await connectVia(handle.port, `other.test:${upstreamPort}`)).toContain("403")
    expect(handle.denials()).toBe(1)
  })

  test("a slow upstream body is not cut off by the connect timeout", async () => {
    let upstreamPort: number
    try {
      upstreamPort = await startServer(
        http.createServer((_req, res) => {
          res.writeHead(200, { "content-type": "text/plain" })
          res.write("first;")
          setTimeout(() => res.end("second"), 300)
        }),
      )
    } catch (error) {
      if (socketBlocked(error)) return
      throw error
    }
    const handle = await startOrSkip({
      allowedDomains: ["allowed.test"],
      lookup: loopbackLookup,
      isPrivate: allowLoopback,
      connectTimeoutMs: 100,
    })
    if (!handle) return
    const result = await viaProxy(handle.port, `http://allowed.test:${upstreamPort}/`)
    expect(result.status).toBe(200)
    expect(result.body).toBe("first;second")
  })

  test("CONNECT to a refused upstream answers 502 instead of dropping the socket", async () => {
    let closedPort: number
    try {
      const probe = net.createServer()
      closedPort = await startServer(probe)
      await new Promise<void>((resolve) => probe.close(() => resolve()))
      activeServers.splice(activeServers.indexOf(probe), 1)
    } catch (error) {
      if (socketBlocked(error)) return
      throw error
    }
    const handle = await startOrSkip({
      allowedDomains: ["allowed.test"],
      lookup: loopbackLookup,
      isPrivate: allowLoopback,
    })
    if (!handle) return
    const line = await connectVia(handle.port, `allowed.test:${closedPort}`).catch(
      (error: Error) => `error:${error.message}`,
    )
    expect(line).toContain("502")
  })

  test("an idle CONNECT tunnel outlives the connect timeout", async () => {
    let upstreamPort: number
    try {
      upstreamPort = await startServer(
        net.createServer((socket) => {
          socket.on("data", (chunk) => socket.write(chunk))
        }),
      )
    } catch (error) {
      if (socketBlocked(error)) return
      throw error
    }
    const handle = await startOrSkip({
      allowedDomains: ["allowed.test"],
      lookup: loopbackLookup,
      isPrivate: allowLoopback,
      connectTimeoutMs: 100,
    })
    if (!handle) return
    const echoed = await new Promise<string>((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port: handle.port }, () => {
        socket.write(`CONNECT allowed.test:${upstreamPort} HTTP/1.1\r\nHost: allowed.test\r\n\r\n`)
      })
      let established = false
      socket.on("data", (chunk) => {
        if (!established) {
          established = true
          setTimeout(() => socket.write("ping"), 300)
          return
        }
        resolve(chunk.toString())
        socket.destroy()
      })
      socket.on("close", () => resolve("closed"))
      socket.on("error", reject)
      setTimeout(() => {
        resolve("no echo")
        socket.destroy()
      }, 2_000)
    })
    expect(echoed).toBe("ping")
  })

  test("stops cleanly and stops accepting connections", async () => {
    const handle = await startOrSkip({ allowedDomains: ["example.com"] })
    if (!handle) return
    const port = handle.port
    expect(port).toBeGreaterThan(0)
    await handle.stop()
    const after = await fetch(`http://127.0.0.1:${port}/`).catch(() => "refused")
    expect(after === "refused" || (after as Response).status !== 200).toBe(true)
  })
})
