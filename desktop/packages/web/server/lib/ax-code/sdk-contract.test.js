/**
 * Contract guard for the workspace @ax-code/sdk.
 *
 * Keep these checks aligned with the workspace SDK package exports and
 * generated declaration output.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SDK_VERSION, createAgent } from "@ax-code/sdk"
import { startHeadlessBackend, isLoopbackHostname } from "@ax-code/sdk/headless"
import { createAxCodeClient as createAxCodeClientV2 } from "@ax-code/sdk/v2"
import { createAxCodeClient as createAxCodeClientV2Client } from "@ax-code/sdk/v2/client"

const sdkPackageRoot = resolve(dirname(fileURLToPath(import.meta.resolve("@ax-code/sdk"))), "..")
const sdkPackageJson = JSON.parse(readFileSync(resolve(sdkPackageRoot, "package.json"), "utf8"))
const headlessLifecycleTypes = readFileSync(resolve(sdkPackageRoot, "dist/headless/lifecycle.d.ts"), "utf8")

describe("workspace @ax-code/sdk contract", () => {
  it("loads the same SDK package version exposed by the runtime entry point", () => {
    expect(SDK_VERSION).toBe(sdkPackageJson.version)
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("exposes every entry point this app imports", () => {
    const exportsMap = sdkPackageJson.exports ?? {}
    for (const entry of [".", "./v2", "./v2/client", "./headless"]) {
      expect(exportsMap[entry], `missing SDK export "${entry}"`).toBeDefined()
    }
    expect(typeof createAgent).toBe("function")
    expect(typeof createAxCodeClientV2).toBe("function")
    expect(typeof createAxCodeClientV2Client).toBe("function")
  })

  it("still provides startHeadlessBackend for the managed runtime", () => {
    expect(typeof startHeadlessBackend).toBe("function")
  })

  it("exports isLoopbackHostname for the managed runtime loopback guard", () => {
    expect(typeof isLoopbackHostname).toBe("function")
  })

  it("supports explicit binary/args and startup diagnostics for the managed runtime", () => {
    expect(headlessLifecycleTypes).toContain("binary?: string")
    expect(headlessLifecycleTypes).toContain("args?: string[]")
    expect(headlessLifecycleTypes).toContain("diagnostics: HeadlessBackendDiagnostics")
  })
})

describe("isLoopbackHostname", () => {
  it("treats loopback hostnames as loopback", () => {
    for (const hostname of ["localhost", "LOCALHOST", "::1", "[::1]", "127.0.0.1", "127.5.5.5"]) {
      expect(isLoopbackHostname(hostname), `expected "${hostname}" to be loopback`).toBe(true)
    }
  })

  it("treats network hostnames as non-loopback", () => {
    for (const hostname of ["0.0.0.0", "192.168.1.10", "10.0.0.1", "example.com", "128.0.0.1", "127.0.0"]) {
      expect(isLoopbackHostname(hostname), `expected "${hostname}" to be non-loopback`).toBe(false)
    }
  })
})
