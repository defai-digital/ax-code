import { describe, expect, test } from "vitest"

import { rewriteAppProtocolNetworkUrl, rewriteAppProtocolWebSocketUrl } from "./app-protocol-network"

const options = { pageOrigin: "app://ax-code", apiOrigin: "http://127.0.0.1:3910" }

describe("app protocol network rewrite", () => {
  test("rewrites relative API paths to the loopback server", () => {
    expect(rewriteAppProtocolNetworkUrl("/api/fs/list?path=/repo", options)).toBe(
      "http://127.0.0.1:3910/api/fs/list?path=/repo",
    )
    expect(rewriteAppProtocolNetworkUrl("/assets/index.js", options)).toBe("/assets/index.js")
  })

  test("rewrites app-origin absolute API URLs", () => {
    expect(rewriteAppProtocolNetworkUrl("app://ax-code/api/session", options)).toBe("http://127.0.0.1:3910/api/session")
    expect(rewriteAppProtocolWebSocketUrl("/api/event/ws", options)).toBe("ws://127.0.0.1:3910/api/event/ws")
  })
})
