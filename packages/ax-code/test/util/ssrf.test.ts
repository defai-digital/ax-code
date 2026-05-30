import { expect, mock, test } from "bun:test"

const ssrfModule = "../../src/util/ssrf.ts" + "?ssrf-unit"
const { Ssrf } = (await import(ssrfModule)) as typeof import("../../src/util/ssrf")

test("pinnedFetch rejects non-http redirect targets before following them", async () => {
  // Use injected DNS and fetch functions so this unit test never opens a socket.
  const dnsResolveFn = mock(async (_hostname: string) => [{ address: "1.2.3.4", family: 4 }])
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
