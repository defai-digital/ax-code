import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { ComputerUseProvider, ProbeReport } from "@ax-code/computer"
import { getComputerUseCheck } from "../../src/cli/cmd/doctor-computer"

// Computer.resolveBackend honors AX_COMPUTER_*_COMMAND host env overrides and
// discovers the ax-computer bridge on PATH; the default-command assertions
// below would fail on a machine that exports them. Pin them away (PATH points
// at a directory without ax-computer) so the check output is host-independent.
beforeEach(() => {
  vi.stubEnv("AX_COMPUTER_CUA_COMMAND", undefined)
  vi.stubEnv("AX_COMPUTER_AXNATIVE_COMMAND", undefined)
  vi.stubEnv("AX_COMPUTER_COMMAND", undefined)
  vi.stubEnv("PATH", "/nonexistent-test-path")
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
      config: { provider: "axnative", command: "ax-computer-driver" },
      platform: "darwin",
      probe: probeReturning({ ok: true, provider: "axnative", latencyMs: 30, apps: 3 }),
    })
    // an explicit command pins the deprecated legacy shim → warn, not ok
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("provider axnative via ax-computer-driver mcp")
    expect(check.detail).toContain("Accessibility/Screen Recording")
    expect(check.detail).toContain("DEPRECATED")
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
      config: { provider: "cua", command: "/opt/cua/bin/cua-driver", args: ["serve"] },
      platform: "darwin",
      probe: probeReturning({ ok: true, provider: "cua", latencyMs: 5, apps: 1 }),
    })
    expect(check.detail).toContain("via /opt/cua/bin/cua-driver serve")
  })

  test("legacy command override → deprecation warn with the migration hint, even when the probe succeeds", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "cua", command: "/opt/cua/bin/cua-driver" },
      platform: "darwin",
      probe: probeReturning({ ok: true, provider: "cua", latencyMs: 5, apps: 1 }),
    })
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("via /opt/cua/bin/cua-driver mcp")
    expect(check.detail).toContain("DEPRECATED")
    expect(check.detail).toContain("unset it and install the ax-computer server")
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

  test("axnative probe ok with a legacy command override → deprecation warn", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "axnative", command: process.execPath },
      platform: "darwin",
      probe: probeReturning({ ok: true, provider: "axnative", latencyMs: 9, apps: 2 }),
    })
    expect(check.status).toBe("warn")
    expect(check.detail).toContain(`provider axnative via ${process.execPath} mcp`)
    expect(check.detail).toContain("DEPRECATED")
    expect(check.detail).toContain("future major release")
  })

  test("alias routes through the ax-computer bridge when AX_COMPUTER_COMMAND is resolvable", async () => {
    vi.stubEnv("AX_COMPUTER_COMMAND", process.execPath)
    const check = await getComputerUseCheck({
      config: { provider: "cua" },
      platform: "linux",
      probe: probeReturning({ ok: true, provider: "cua", latencyMs: 15, apps: 2 }),
    })
    expect(check.status).toBe("ok")
    expect(check.detail).toContain(`provider cua via ${process.execPath} mcp --backend cua`)
    expect(check.detail).not.toContain("DEPRECATED")
  })

  test("alias bridge binary missing → fail fast, no probe spawned", async () => {
    vi.stubEnv("AX_COMPUTER_COMMAND", "/nonexistent/ax-computer")
    const probe = probeReturning({ ok: true })
    const check = await getComputerUseCheck({
      config: { provider: "axnative" },
      platform: "darwin",
      probe,
    })
    expect(check.status).toBe("fail")
    expect(check.detail).toContain("/nonexistent/ax-computer")
    expect(check.detail).toContain("ax-computer server")
    expect(probe).not.toHaveBeenCalled()
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

  test("external without a command → fail with the explicit-command requirement", async () => {
    const probe = probeReturning({ ok: true })
    const check = await getComputerUseCheck({ config: { provider: "external" }, platform: "darwin", probe })
    expect(check.status).toBe("fail")
    expect(check.detail).toContain("requires an explicit command")
    expect(check.detail).toContain("AX_COMPUTER_COMMAND")
    expect(probe).not.toHaveBeenCalled()
  })

  test("external with a missing binary path fails fast, no probe spawned", async () => {
    const probe = probeReturning({ ok: true })
    const check = await getComputerUseCheck({
      config: { provider: "external", command: "/nonexistent/ax-computer-server" },
      platform: "darwin",
      probe,
    })
    expect(check.status).toBe("fail")
    expect(check.detail).toContain("/nonexistent/ax-computer-server")
    expect(check.detail).toContain("AX_COMPUTER_COMMAND")
    expect(probe).not.toHaveBeenCalled()
  })

  test("external probe ok → ok with command and latency", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "external", command: process.execPath },
      platform: "linux",
      probe: probeReturning({ ok: true, provider: "external", latencyMs: 21, apps: 4 }),
    })
    expect(check.status).toBe("ok")
    expect(check.detail).toContain(`provider external via ${process.execPath}`)
    expect(check.detail).toContain("4 apps visible")
  })

  test("external protocol incompatibility surfaces as a doctor failure", async () => {
    const check = await getComputerUseCheck({
      config: { provider: "external", command: "ax-computer-server" },
      platform: "darwin",
      probe: probeReturning({
        ok: false,
        provider: "external",
        error:
          "ProtocolError: AX Computer protocol version mismatch: this client speaks versions 1..1, but the server speaks 99..99.",
      }),
    })
    expect(check.status).toBe("fail")
    expect(check.detail).toContain('"ax-computer-server"')
    expect(check.detail).toContain("AX_COMPUTER_COMMAND")
    expect(check.detail).toContain("protocol version mismatch")
  })
})
