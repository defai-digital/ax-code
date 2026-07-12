import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { Config } from "../../src/config/config"
import { isLocalhostOnly, resolveNetworkOptions, type NetworkOptions } from "../../src/cli/network"

let configSpy: MockInstance | undefined

afterEach(() => {
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
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({ server: { port: 9999 } } as any)

    const result = await resolveNetworkOptions(defaults({ port: 4096 }), ["serve", "--port=4096"])

    expect(result.port).toBe(4096)
  })

  test("space form --port N wins over a configured port", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({ server: { port: 9999 } } as any)

    const result = await resolveNetworkOptions(defaults({ port: 4096 }), ["serve", "--port", "4096"])

    expect(result.port).toBe(4096)
  })

  test("no --port flag falls back to the configured port", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({ server: { port: 9999 } } as any)

    const result = await resolveNetworkOptions(defaults({ port: 0 }), ["serve"])

    expect(result.port).toBe(9999)
  })

  test("--no-mdns wins over configured mdns", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({ server: { mdns: true } } as any)

    const result = await resolveNetworkOptions(defaults({ mdns: false }), ["serve", "--no-mdns"])

    expect(result.mdns).toBe(false)
  })

  test("rejects an explicit non-loopback hostname", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({ server: { hostname: "10.0.0.1" } } as any)

    await expect(
      resolveNetworkOptions(defaults({ hostname: "0.0.0.0" }), ["serve", "--hostname=0.0.0.0"]),
    ).rejects.toThrow("local-only")
  })

  test("ignores persisted remote bind and mDNS settings", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({ server: { hostname: "0.0.0.0", mdns: true } } as any)

    const result = await resolveNetworkOptions(defaults(), ["serve"])

    expect(result).toMatchObject({ hostname: "127.0.0.1", mdns: false })
  })

  test("rejects explicitly enabled mDNS", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({} as any)

    await expect(resolveNetworkOptions(defaults({ mdns: true }), ["serve", "--mdns"])).rejects.toThrow("local-only")
  })

  test("normalizes bracketed IPv6 loopback for socket binding", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({} as any)

    const result = await resolveNetworkOptions(defaults({ hostname: "[::1]" }), ["serve", "--hostname=[::1]"])

    expect(result.hostname).toBe("::1")
  })

  test("keeps loopback CORS origins and ignores persisted remote origins", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({
      server: { cors: ["https://remote.example", "http://localhost:5173/"] },
    } as any)

    const result = await resolveNetworkOptions(defaults({ cors: ["http://127.0.0.1:4173"] }), ["serve"])

    expect(result.cors).toEqual(["http://localhost:5173", "http://127.0.0.1:4173"])
  })

  test("rejects an explicitly configured remote CORS origin", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({} as any)

    await expect(
      resolveNetworkOptions(defaults({ cors: ["https://remote.example"] }), ["serve", "--cors=https://remote.example"]),
    ).rejects.toThrow("loopback origins")
  })

  test("uses raw argv attached by CLI middleware", async () => {
    configSpy = vi.spyOn(Config, "global").mockResolvedValue({ server: { port: 9999 } } as any)
    const args = defaults({ port: 4096 }) as NetworkOptions & { __axCodeRawArgv?: string[] }
    Object.defineProperty(args, "__axCodeRawArgv", {
      value: ["serve", "--port=4096"],
      enumerable: false,
    })

    const result = await resolveNetworkOptions(args)

    expect(result.port).toBe(4096)
  })
})

describe("isLocalhostOnly", () => {
  test("accepts loopback hostnames and literals", () => {
    for (const hostname of ["localhost", "LOCALHOST", "127.0.0.1", "127.12.0.1", "::1", "[::1]"]) {
      expect(isLocalhostOnly(hostname)).toBe(true)
    }
  })

  test("rejects network and loopback-looking hostnames", () => {
    for (const hostname of ["0.0.0.0", "127.0.0.1.evil.com", "localhost.evil.com"]) {
      expect(isLocalhostOnly(hostname)).toBe(false)
    }
  })
})
