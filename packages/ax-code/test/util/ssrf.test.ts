import { expect, test, vi } from "vitest"
import https from "node:https"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"

const ssrfModule = "../../src/util/ssrf.ts" + "?ssrf-unit"
const { Ssrf } = (await import(ssrfModule)) as typeof import("../../src/util/ssrf")

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
