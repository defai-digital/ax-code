import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { ComputerUseProvider, ProbeReport } from "@ax-code/computer"
import { getComputerUseCheck } from "../../src/cli/cmd/doctor-computer"

// Computer.resolveBackend honors AX_COMPUTER_*_COMMAND host env overrides, and
// the default-command assertions below would fail on a machine that exports
// them. Pin them away so the check output is host-independent.
beforeEach(() => {
  vi.stubEnv("AX_COMPUTER_CUA_COMMAND", undefined)
  vi.stubEnv("AX_COMPUTER_OCU_COMMAND", undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function probeReturning(report: Partial<ProbeReport>) {
  return vi.fn(
    async (_provider: ComputerUseProvider): Promise<ProbeReport> => ({
      ok: true,
      provider: "fake",
      latencyMs: 12,
      ...report,
    }),
  )
}

describe("doctor computer use check", () => {
  test("not configured → ok with enablement hint", async () => {
    const check = await getComputerUseCheck({ config: undefined })
    expect(check).toEqual({
      name: "Computer use",
      status: "ok",
      detail: "not configured (set computer.provider to enable desktop control)",
    })
  })

  test("probe ok → ok with command, latency, and app count", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "cua" },
      platform: "linux",
      probe: probeReturning({ ok: true, provider: "cua", latencyMs: 42, apps: 7 }),
    })
    expect(check.status).toBe("ok")
    expect(check.detail).toBe("provider cua via cua-driver mcp — handshake ok in 42ms, 7 apps visible")
  })

  test("probe ok on darwin appends the TCC host-process reminder", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "ocu" },
      platform: "darwin",
      probe: probeReturning({ ok: true, provider: "ocu", latencyMs: 30, apps: 3 }),
    })
    expect(check.status).toBe("ok")
    expect(check.detail).toContain("provider ocu via open-computer-use mcp")
    expect(check.detail).toContain("Accessibility/Screen Recording")
  })

  test("probe failure → fail with command tried, env override, and install hint", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "cua" },
      platform: "darwin",
      probe: probeReturning({
        ok: false,
        provider: "cua",
        error: 'McpClientError: failed to spawn MCP server "cua-driver": spawn ENOENT.',
      }),
    })
    expect(check.status).toBe("fail")
    expect(check.detail).toContain('"cua-driver mcp"')
    expect(check.detail).toContain("AX_COMPUTER_CUA_COMMAND")
    expect(check.detail).toContain("Install cua-driver")
    expect(check.detail).toContain("spawn ENOENT")
  })

  test("config command override is reflected in the reported command", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "ocu", command: "/opt/ocu/bin/ocu", args: ["serve"] },
      platform: "darwin",
      probe: probeReturning({ ok: true, provider: "ocu", latencyMs: 5, apps: 1 }),
    })
    expect(check.detail).toContain("via /opt/ocu/bin/ocu serve")
  })

  test("ocu on non-darwin → warn, no probe spawned", async () => {
    const probe = probeReturning({ ok: true })
    const check = await getComputerUseCheck({
      config: { provider: "ocu" },
      platform: "linux",
      probe,
    })
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("OCU is macOS-only")
    expect(probe).not.toHaveBeenCalled()
  })

  test("unexpected throw becomes a warn, never a crash", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "cua" },
      platform: "darwin",
      probe: async () => {
        throw new Error("kaboom")
      },
    })
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("kaboom")
  })

  test("axnative with a missing binary path fails fast with a swift-build hint", async () => {
    const probe = probeReturning({ ok: true })
    const check = await getComputerUseCheck({
      config: { provider: "axnative", command: "/nonexistent/ax-computer-driver" },
      platform: "darwin",
      probe,
    })
    expect(check.status).toBe("fail")
    expect(check.detail).toContain("/nonexistent/ax-computer-driver")
    expect(check.detail).toContain("build:native")
    expect(probe).not.toHaveBeenCalled()
  })

  test("axnative probe ok → ok with command and latency", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "axnative", command: process.execPath },
      platform: "darwin",
      probe: probeReturning({ ok: true, provider: "axnative", latencyMs: 9, apps: 2 }),
    })
    expect(check.status).toBe("ok")
    expect(check.detail).toContain(`provider axnative via ${process.execPath} mcp`)
  })

  test("axnative on non-darwin → warn, no probe spawned", async () => {
    const probe = probeReturning({ ok: true })
    const check = await getComputerUseCheck({
      config: { provider: "axnative" },
      platform: "linux",
      probe,
    })
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("macOS-only")
    expect(probe).not.toHaveBeenCalled()
  })
})
