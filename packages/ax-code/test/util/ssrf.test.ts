import { afterEach, expect, mock, test } from "bun:test"
import { Ssrf } from "../../src/util/ssrf"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("pinnedFetch rejects non-http redirect targets before following them", async () => {
  const fetchMock = mock(async () => {
    return new Response(null, {
      status: 302,
      headers: {
        location: "file:///etc/passwd",
      },
    })
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch

  await expect(Ssrf.pinnedFetch("http://93.184.216.34/start", { label: "ssrf-test" })).rejects.toThrow(
    "ssrf-test: redirect to unsupported URL scheme: file:",
  )
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
