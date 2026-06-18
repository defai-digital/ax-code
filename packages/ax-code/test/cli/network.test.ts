import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Config } from "../../src/config/config"
import { isLocalhostOnly, resolveNetworkOptions, type NetworkOptions } from "../../src/cli/network"

const ORIGINAL_ARGV = process.argv
let configSpy: ReturnType<typeof spyOn<typeof Config, "global">> | undefined

afterEach(() => {
  process.argv = ORIGINAL_ARGV
  configSpy?.mockRestore()
})

function defaults(overrides: Partial<NetworkOptions> = {}): NetworkOptions {
  return {
    port: 0,
    hostname: "127.0.0.1",
    mdns: false,
    "mdns-domain": "ax-code.local",
    cors: [],
    ...overrides,
  } as NetworkOptions
}

describe("resolveNetworkOptions explicit-flag detection", () => {
  test("equals form --port=N wins over a configured port", async () => {
    // Regression: process.argv.includes("--port") never matched the equals
    // form, so an explicit --port=4096 was silently overridden by config.
    configSpy = spyOn(Config, "global").mockResolvedValue({ server: { port: 9999 } } as any)
    process.argv = ["bun", "ax-code", "serve", "--port=4096"]

    const result = await resolveNetworkOptions(defaults({ port: 4096 }))

    expect(result.port).toBe(4096)
  })

  test("space form --port N wins over a configured port", async () => {
    configSpy = spyOn(Config, "global").mockResolvedValue({ server: { port: 9999 } } as any)
    process.argv = ["bun", "ax-code", "serve", "--port", "4096"]

    const result = await resolveNetworkOptions(defaults({ port: 4096 }))

    expect(result.port).toBe(4096)
  })

  test("no --port flag falls back to the configured port", async () => {
    configSpy = spyOn(Config, "global").mockResolvedValue({ server: { port: 9999 } } as any)
    process.argv = ["bun", "ax-code", "serve"]

    const result = await resolveNetworkOptions(defaults({ port: 0 }))

    expect(result.port).toBe(9999)
  })

  test("equals form --hostname=X wins over a configured hostname", async () => {
    configSpy = spyOn(Config, "global").mockResolvedValue({ server: { hostname: "10.0.0.1" } } as any)
    process.argv = ["bun", "ax-code", "serve", "--hostname=0.0.0.0"]

    const result = await resolveNetworkOptions(defaults({ hostname: "0.0.0.0" }))

    expect(result.hostname).toBe("0.0.0.0")
  })
})

describe("isLocalhostOnly", () => {
  test("accepts loopback hostnames and literals", () => {
    for (const hostname of ["localhost", "127.0.0.1", "127.12.0.1", "::1", "[::1]"]) {
      expect(isLocalhostOnly(hostname)).toBe(true)
    }
  })

  test("rejects network and loopback-looking hostnames", () => {
    for (const hostname of ["0.0.0.0", "127.0.0.1.evil.com", "localhost.evil.com"]) {
      expect(isLocalhostOnly(hostname)).toBe(false)
    }
  })
})
