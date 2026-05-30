import { expect, mock, test } from "bun:test"
import { Ssrf } from "../../src/util/ssrf"

test("pinnedFetch rejects non-http redirect targets before following them", async () => {
  // Use an IP-literal URL so the test bypasses DNS entirely. pinnedFetchOnce
  // takes the net.isIP() shortcut and calls fetchFn directly — no dns.lookup,
  // no real network. 1.2.3.4 is a public, non-private IPv4 address.
  const fetchMock = mock(async () => {
    return new Response(null, {
      status: 302,
      headers: {
        location: "file:///etc/passwd",
      },
    })
  })

  await expect(Ssrf.pinnedFetch("http://1.2.3.4/start", { label: "ssrf-test" }, fetchMock)).rejects.toThrow(
    "ssrf-test: redirect to unsupported URL scheme: file:",
  )
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
