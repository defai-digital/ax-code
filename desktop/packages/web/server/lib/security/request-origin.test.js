import { describe, expect, it } from "vitest"

import { firstForwardedHeaderValue, getRequestOrigin, getRequestRpId } from "./request-origin.js"

describe("request origin helpers", () => {
  it("trims the first forwarded header value", () => {
    expect(firstForwardedHeaderValue(" https , http ")).toBe("https")
  })

  it("uses trimmed hostname fallback when host headers are absent", () => {
    const req = {
      headers: {},
      hostname: " localhost:3902 ",
      socket: { encrypted: false },
    }

    expect(getRequestRpId(req)).toBe("localhost")
    expect(getRequestOrigin(req)).toBe("")
  })
})
