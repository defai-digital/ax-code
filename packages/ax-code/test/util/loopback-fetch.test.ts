import { expect, test, vi } from "vitest"
import { Ssrf } from "../../src/util/ssrf"

const origin = "http://localhost:3845"

test.each(["127.0.0.1", "[::1]", "localhost"])("loopback fetch pins %s and preserves request options", async (host) => {
  const url = `http://${host}:3845/mcp`
  const fetch = vi.fn(async () => new Response("ok"))
  const dns = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }])
  const signal = new AbortController().signal
  const response = await Ssrf.pinnedLoopbackFetch(
    url,
    Ssrf.loopbackOrigin(url),
    { method: "POST", body: "payload", headers: { "X-Test": "value" }, signal },
    fetch,
    dns,
  )
  expect(await response.text()).toBe("ok")
  const [target, options] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(target).toBe(`http://${host === "localhost" ? "127.0.0.1" : host}:3845/mcp`)
  expect(options).toMatchObject({ method: "POST", body: "payload", signal, redirect: "manual" })
  expect(new Headers(options.headers).get("X-Test")).toBe("value")
  expect(dns).toHaveBeenCalledTimes(host === "localhost" ? 1 : 0)
})

test.each([
  "http://10.0.0.1/mcp",
  "http://169.254.169.254/mcp",
  "http://0.0.0.0/mcp",
  "http://[::ffff:127.0.0.1]/mcp",
  "http://example.com/mcp",
  "http://localhost.example.com/mcp",
  "http://user:password@localhost:3845/mcp",
  "file://localhost/mcp",
])("loopback opt-in rejects invalid configured URL %s", (url) => {
  expect(() => Ssrf.loopbackOrigin(url)).toThrow()
})

test.each(["127.0.0.1", "[::1]"])("public-only fetch still denies %s", async (host) => {
  const fetch = vi.fn()
  await expect(Ssrf.assertPublicUrl(`http://${host}:3845/mcp`)).rejects.toThrow("private/reserved")
  await expect(Ssrf.pinnedFetch(`http://${host}:3845/mcp`, {}, fetch)).rejects.toThrow("private/reserved")
  expect(fetch).not.toHaveBeenCalled()
})

test.each(["10.0.0.1", "169.254.169.254", "8.8.8.8", "::ffff:7f00:1"])(
  "localhost DNS rejects mixed answers containing %s before network access",
  async (address) => {
    const fetch = vi.fn()
    const dns = vi.fn(async () => [
      { address: "127.0.0.1", family: 4 },
      { address, family: address.includes(":") ? 6 : 4 },
    ])
    await expect(Ssrf.pinnedLoopbackFetch(`${origin}/mcp`, origin, {}, fetch, dns)).rejects.toThrow("loopback")
    expect(fetch).not.toHaveBeenCalled()
  },
)

test.each([
  "http://localhost:3846/mcp",
  "http://127.0.0.1:3845/mcp",
  "https://localhost:3845/mcp",
  "http://169.254.169.254/latest/meta-data/",
  "https://example.com/oauth",
  "http://user:password@localhost:3845/mcp",
])("loopback redirects and direct secondary requests reject %s", async (target) => {
  const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: target } }))
  const dns = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }])
  await expect(Ssrf.pinnedLoopbackFetch(`${origin}/mcp`, origin, {}, fetch, dns)).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockClear()
  await expect(Ssrf.pinnedLoopbackFetch(target, origin, {}, fetch, dns)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})

test("same-origin redirects revalidate DNS and cannot rebind localhost", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 307, headers: { location: "/next" } }))
  const dns = vi
    .fn()
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }])
    .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
  await expect(Ssrf.pinnedLoopbackFetch(`${origin}/mcp`, origin, {}, fetch, dns)).rejects.toThrow("loopback")
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(dns).toHaveBeenCalledTimes(2)
})

test("an already aborted loopback request opens no connection", async () => {
  const fetch = vi.fn()
  await expect(
    Ssrf.pinnedLoopbackFetch(`${origin}/mcp`, origin, { signal: AbortSignal.abort() }, fetch),
  ).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
