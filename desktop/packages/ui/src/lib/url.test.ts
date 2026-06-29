import { describe, expect, test } from "vitest"
import { extractLoopbackUrls, isLoopbackHttpUrl } from "./url"

describe("loopback URL helpers", () => {
  test("treats the full IPv4 127/8 range as loopback", () => {
    expect(isLoopbackHttpUrl("http://127.0.0.2:5173/")).toBe(true)
    expect(isLoopbackHttpUrl("http://127.10.20.30:3000/path")).toBe(true)
    expect(isLoopbackHttpUrl("https://example.com")).toBe(false)
  })

  test("extracts IPv4 loopback preview URLs from free text", () => {
    expect(extractLoopbackUrls("Server ready at http://127.0.0.2:5173/app.")).toEqual([
      "http://127.0.0.2:5173/app",
    ])
  })
})
