import { fileURLToPath } from "node:url"
import { describe, expect, test, vi } from "vitest"
import type { ActionResult, ComputerAction } from "../src/action"
import { probeProvider } from "../src/probe"
import type { ComputerUseProvider, ObserveScope, ProviderCapabilities } from "../src/provider"
import type { AppInfo, ComputerObservation } from "../src/types"
import { UpstreamOcuReferenceProvider } from "./helpers/upstream-ocu"

const server = fileURLToPath(new URL("./helpers/fake-mcp-server.mjs", import.meta.url))

function ocuOnFakeServer(mode: string) {
  return new UpstreamOcuReferenceProvider({ command: process.execPath, args: [server, mode] })
}

/** never answers listApps; records dispose so timeout cleanup is observable */
class HangingProvider implements ComputerUseProvider {
  readonly name = "hanging"
  disposed = false

  capabilities(): ProviderCapabilities {
    return { actions: [], backgroundDelivery: false, elementTargeting: false, windowActivation: false }
  }

  listApps(): Promise<AppInfo[]> {
    return new Promise(() => {})
  }

  observe(_scope: ObserveScope): Promise<ComputerObservation> {
    return Promise.reject(new Error("not implemented"))
  }

  act(_action: ComputerAction): Promise<ActionResult> {
    return Promise.reject(new Error("not implemented"))
  }

  async dispose(): Promise<void> {
    this.disposed = true
  }
}

describe("probeProvider", () => {
  test("ok path: real MCP round-trip (spawn + handshake + list_apps), apps counted", async () => {
    const provider = ocuOnFakeServer("basic")
    const dispose = vi.spyOn(provider, "dispose")
    const report = await probeProvider(provider)

    // the fake server answers list_apps with an empty catalog text
    expect(report).toMatchObject({ ok: true, provider: "ocu", apps: 0 })
    expect(report.latencyMs).toBeGreaterThanOrEqual(0)
    expect(report.error).toBeUndefined()
    // a successful probe must not leak the backend process either
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test("spawn failure: ok:false, error names the command", async () => {
    const provider = new UpstreamOcuReferenceProvider({ command: "ax-code-definitely-not-a-real-binary" })
    const dispose = vi.spyOn(provider, "dispose")
    const report = await probeProvider(provider)

    expect(report.ok).toBe(false)
    expect(report.provider).toBe("ocu")
    expect(report.error).toContain("ax-code-definitely-not-a-real-binary")
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  test("slow server: timeout flips ok:false and disposes the provider", async () => {
    const provider = new HangingProvider()
    const report = await probeProvider(provider, { timeoutMs: 200 })

    expect(report.ok).toBe(false)
    expect(report.error).toMatch(/timed out/)
    expect(report.latencyMs).toBeGreaterThanOrEqual(150)
    expect(provider.disposed).toBe(true)
  })
})
