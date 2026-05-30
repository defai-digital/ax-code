import { expect, mock, test } from "bun:test"
import { Ssrf } from "../../src/util/ssrf"

test("pinnedFetch rejects non-http redirect targets before following them", async () => {
  // Use a fake hostname + injected dnsResolveFn so no real network address
  // is involved. Bun speculatively preconnects to IP literals even when a
  // custom fetchFn is supplied, which causes this test to fail on CI runners
  // that cannot reach external hosts. Using a non-resolvable hostname with an
  // injected resolver avoids all native fetch / TCP machinery.
  const dnsResolveFn = mock(async (_hostname: string) => [{ address: "1.2.3.4", family: 4 }])
  const fetchMock = mock(async () => {
    return new Response(null, {
      status: 302,
      headers: {
        location: "file:///etc/passwd",
      },
    })
  })

  await expect(
    Ssrf.pinnedFetch("http://example.invalid/start", { label: "ssrf-test" }, fetchMock, dnsResolveFn),
  ).rejects.toThrow("ssrf-test: redirect to unsupported URL scheme: file:")

  expect(dnsResolveFn).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
