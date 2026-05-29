import { expect, mock, test } from "bun:test"
import { Ssrf } from "../../src/util/ssrf"

test("pinnedFetch rejects non-http redirect targets before following them", async () => {
  const fetchMock = mock(async () => {
    return new Response(null, {
      status: 302,
      headers: {
        location: "file:///etc/passwd",
      },
    })
  })

  await expect(Ssrf.pinnedFetch("http://93.184.216.34/start", { label: "ssrf-test" }, fetchMock)).rejects.toThrow(
    "ssrf-test: redirect to unsupported URL scheme: file:",
  )
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
