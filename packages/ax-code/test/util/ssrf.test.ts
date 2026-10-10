import { expect, test, vi } from "vitest"
import https from "node:https"
import http from "node:http"
import { EventEmitter } from "node:events"
import { getEventListeners } from "node:events"
import { Readable } from "node:stream"

const ssrfModule = "../../src/util/ssrf.ts" + "?ssrf-unit"
const { Ssrf } = (await import(ssrfModule)) as typeof import("../../src/util/ssrf")

test.each([
  ["GET", 204],
  ["GET", 205],
  ["GET", 304],
  ["HEAD", 200],
] as const)("pinned HTTPS %s %s returns a null body", async (method, status) => {
  const request = vi.spyOn(https, "request").mockImplementation((...args: unknown[]) => {
    const callback = args[1] as (response: http.IncomingMessage) => void
    const req = new EventEmitter() as EventEmitter & { end(): void; destroy(): void }
    req.end = () => {
      const res = Object.assign(Readable.from([]), { statusCode: status, statusMessage: "OK", headers: {} })
      callback(res as http.IncomingMessage)
    }
    req.destroy = () => {}
    return req as ReturnType<typeof https.request>
  })
  try {
    const response = await Ssrf.pinnedFetch("https://93.184.216.34/empty", { method })
    expect(response.status).toBe(status)
    expect(response.body).toBeNull()
    expect(await response.text()).toBe("")
  } finally {
    request.mockRestore()
  }
})

test("completed pinned HTTPS requests release their shared abort listener", async () => {
  const controller = new AbortController()
  const baseline = getEventListeners(controller.signal, "abort").length
  const request = vi.spyOn(https, "request").mockImplementation((...args: unknown[]) => {
    const callback = args[1] as (response: http.IncomingMessage) => void
    const req = new EventEmitter() as EventEmitter & { end(): void; destroy(): void }
    req.end = () => {
      const res = Object.assign(Readable.from([Buffer.from("ok")]), {
        statusCode: 200,
        statusMessage: "OK",
        headers: {},
      })
      callback(res as http.IncomingMessage)
    }
    req.destroy = () => {}
    return req as ReturnType<typeof https.request>
  })
  try {
    for (let index = 0; index < 12; index++) {
      const response = await Ssrf.pinnedFetch("https://93.184.216.34/body", { signal: controller.signal })
      expect(await response.text()).toBe("ok")
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(baseline)
    }
  } finally {
    request.mockRestore()
  }
})

test("pinnedFetch rejects non-http redirect targets before following them", async () => {
  // Use injected DNS and fetch functions so this unit test never opens a socket.
  const dnsResolveFn = vi.fn(async (_hostname: string) => [{ address: "1.2.3.4", family: 4 }])
  let fetchCalls = 0
  const fetchFn: NonNullable<Parameters<typeof Ssrf.pinnedFetch>[2]> = async () => {
    fetchCalls++
    return new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } })
  }

  await expect(
    Ssrf.pinnedFetch("http://example.invalid/start", { label: "ssrf-test" }, fetchFn, dnsResolveFn),
  ).rejects.toThrow("ssrf-test: redirect to unsupported URL scheme: file:")

  expect(dnsResolveFn).toHaveBeenCalledTimes(1)
  expect(fetchCalls).toBe(1)
})

test("assertPublicUrl rejects hex-form IPv4-mapped IPv6 literals (loopback + cloud metadata)", async () => {
  // ::ffff:7f00:1 == 127.0.0.1, ::ffff:a9fe:a9fe == 169.254.169.254 (metadata).
  await expect(Ssrf.assertPublicUrl("http://[::ffff:7f00:1]/", "t")).rejects.toThrow("private/reserved")
  await expect(Ssrf.assertPublicUrl("http://[::ffff:a9fe:a9fe]/latest/meta-data/", "t")).rejects.toThrow(
    "private/reserved",
  )
  // Uncompressed and dotted forms of the same address must also be rejected.
  await expect(Ssrf.assertPublicUrl("http://[0:0:0:0:0:ffff:7f00:1]/", "t")).rejects.toThrow("private/reserved")
  await expect(Ssrf.assertPublicUrl("http://[::ffff:127.0.0.1]/", "t")).rejects.toThrow("private/reserved")
})

test("assertPublicUrl rejects bare and deprecated/NAT64 private IPv6 forms", async () => {
  await expect(Ssrf.assertPublicUrl("http://[::1]/", "t")).rejects.toThrow("private/reserved")
  await expect(Ssrf.assertPublicUrl("http://[fd00::1]/", "t")).rejects.toThrow("private/reserved")
  await expect(Ssrf.assertPublicUrl("http://[fe80::1]/", "t")).rejects.toThrow("private/reserved")
  await expect(Ssrf.assertPublicUrl("http://[64:ff9b::7f00:1]/", "t")).rejects.toThrow("private/reserved") // NAT64 127.0.0.1
})

test("assertPublicUrl allows genuine public IPv6 (literal and mapped)", async () => {
  await expect(Ssrf.assertPublicUrl("http://[2606:4700:4700::1111]/", "t")).resolves.toBeUndefined()
  await expect(Ssrf.assertPublicUrl("http://[::ffff:8.8.8.8]/", "t")).resolves.toBeUndefined()
})

test("pinnedFetch strips credentials on a cross-origin redirect but keeps them same-origin", async () => {
  const dnsResolveFn = vi.fn(async (_hostname: string) => [{ address: "1.2.3.4", family: 4 }])

  const run = async (location: string) => {
    const seen: Array<string | null> = []
    let n = 0
    const fetchFn: NonNullable<Parameters<typeof Ssrf.pinnedFetch>[2]> = async (_url, init) => {
      seen.push(new Headers(init?.headers).get("authorization"))
      n++
      if (n === 1) return new Response(null, { status: 302, headers: { location } })
      return new Response("ok", { status: 200 })
    }
    await Ssrf.pinnedFetch(
      "http://trusted.invalid/start",
      { label: "t", headers: { Authorization: "Bearer secret" } },
      fetchFn,
      dnsResolveFn,
    )
    return seen
  }

  const cross = await run("http://evil.invalid/x")
  expect(cross[0]).toBe("Bearer secret") // sent to the original origin
  expect(cross[1]).toBeNull() // stripped crossing to evil.invalid

  const same = await run("http://trusted.invalid/next")
  expect(same[0]).toBe("Bearer secret")
  expect(same[1]).toBe("Bearer secret") // same origin keeps it
})

test("pinnedFetch no longer passes Bun-only tls RequestInit extension", async () => {
  const dnsResolveFn = vi.fn(async (_hostname: string) => [{ address: "1.2.3.4", family: 4 }])
  let seenInit: RequestInit | undefined
  const fetchFn: NonNullable<Parameters<typeof Ssrf.pinnedFetch>[2]> = async (_url, init) => {
    seenInit = init
    return new Response("ok", { status: 200 })
  }

  await Ssrf.pinnedFetch("https://example.invalid/path", { label: "t" }, fetchFn, dnsResolveFn)

  expect((seenInit as RequestInit & { tls?: unknown })?.tls).toBeUndefined()
  expect(new Headers(seenInit?.headers).get("host")).toBe("example.invalid")
})

test("pinnedFetch omits TLS servername for HTTPS IP literals", async () => {
  let seenOptions: https.RequestOptions | undefined
  const request = vi.spyOn(https, "request").mockImplementation((options: any, callback?: any) => {
    seenOptions = options
    const req = new EventEmitter() as EventEmitter & {
      end: () => void
      destroy: (error?: unknown) => void
    }
    req.end = () => {
      const res = Readable.from([new TextEncoder().encode("ok")]) as Readable & {
        statusCode?: number
        statusMessage?: string
        headers?: Record<string, string>
      }
      res.statusCode = 200
      res.statusMessage = "OK"
      res.headers = { "content-type": "text/plain" }
      callback?.(res)
    }
    req.destroy = () => {}
    return req as unknown as ReturnType<typeof https.request>
  })

  try {
    const response = await Ssrf.pinnedFetch("https://93.184.216.34/file.txt", { label: "t" })

    expect(await response.text()).toBe("ok")
    expect(seenOptions?.hostname).toBe("93.184.216.34")
    expect(seenOptions?.servername).toBeUndefined()
    expect(new Headers(seenOptions?.headers as HeadersInit).get("host")).toBe("93.184.216.34")
  } finally {
    request.mockRestore()
  }
})

test("pinned HTTP abort remains active while the response body is streaming", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200)
    response.write("first chunk")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as import("node:net").AddressInfo
  const origin = `http://127.0.0.1:${address.port}`
  const controller = new AbortController()
  try {
    const response = await Ssrf.pinnedLoopbackFetch(origin, origin, { signal: controller.signal })
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1)
    const body = response.text()
    controller.abort(new Error("stop body"))
    await expect(body).rejects.toThrow()
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test.each([
  [301, "PUT", "PUT"],
  [302, "DELETE", "DELETE"],
  [303, "HEAD", "HEAD"],
  [301, "POST", "GET"],
  [303, "PUT", "GET"],
] as const)("redirect %s preserves the correct method for %s", async (status, method, expected) => {
  const requests: RequestInit[] = []
  const fetchFn: NonNullable<Parameters<typeof Ssrf.pinnedFetch>[2]> = async (_url, init) => {
    requests.push(init!)
    return requests.length === 1
      ? new Response(null, { status, headers: { location: "/next" } })
      : new Response(null, { status: 200 })
  }
  const body = method === "HEAD" ? undefined : "payload"
  await Ssrf.pinnedFetch("https://93.184.216.34/start", { method, body }, fetchFn)
  expect(requests[1].method).toBe(expected)
  expect(requests[1].body).toBe(expected === "GET" ? undefined : body)
})

test("304 is returned even when redirects are refused", async () => {
  const fetchFn: NonNullable<Parameters<typeof Ssrf.pinnedFetch>[2]> = async () => new Response(null, { status: 304 })
  const response = await Ssrf.pinnedFetch("https://93.184.216.34/cache", { redirect: "error" }, fetchFn)
  expect(response.status).toBe(304)
})

test("refused redirects cancel the unreturned response body", async () => {
  const cancel = vi.fn()
  const fetchFn: NonNullable<Parameters<typeof Ssrf.pinnedFetch>[2]> = async () =>
    new Response(new ReadableStream({ cancel }), { status: 302, headers: { location: "/next" } })
  await expect(Ssrf.pinnedFetch("https://93.184.216.34/start", { redirect: "error" }, fetchFn)).rejects.toThrow(
    "redirect refused",
  )
  expect(cancel).toHaveBeenCalledTimes(1)
})

test.each(["GET", "HEAD"])("pinned %s rejects a body before opening a request", async (method) => {
  const request = vi.spyOn(https, "request").mockImplementation(() => {
    throw new Error("unexpected request")
  })
  try {
    await expect(
      Ssrf.pinnedFetch("https://93.184.216.34/body", {
        method,
        body: "hello",
        headers: { "content-length": "5" },
      }),
    ).rejects.toThrow("GET/HEAD requests cannot have a body")
    expect(request).not.toHaveBeenCalled()
  } finally {
    request.mockRestore()
  }
})
