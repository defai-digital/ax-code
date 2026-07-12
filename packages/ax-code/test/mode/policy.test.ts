import { describe, expect, test } from "vitest"
import { ModePolicy } from "../../src/mode/policy"

describe("ModePolicy.resolveMode", () => {
  test("defaults to hybrid when local available", () => {
    const d = ModePolicy.resolveMode(
      {},
      { localAvailable: true, connectedProviderIDs: ["google"] },
    )
    expect(d.mode).toBe("hybrid")
    expect(d.placement).toBe("local")
    expect(d.ensemble).toBe(false)
    expect(d.allowed).toBe(true)
  })

  test("defaults to cloud when local unavailable", () => {
    const d = ModePolicy.resolveMode(
      {},
      { localAvailable: false, connectedProviderIDs: ["google"] },
    )
    expect(d.mode).toBe("cloud")
    expect(d.placement).toBe("cloud")
  })

  test("honors requested local with fallback", () => {
    const d = ModePolicy.resolveMode(
      {},
      { localAvailable: false, connectedProviderIDs: [], requestedMode: "local" },
    )
    expect(d.mode).toBe("cloud")
    expect(d.reasons.some((r) => r.includes("local_unavailable"))).toBe(true)
  })

  test("privacy overrides cloud request to local when available", () => {
    const d = ModePolicy.resolveMode(
      { default: "cloud" },
      {
        localAvailable: true,
        connectedProviderIDs: ["google"],
        privacyRequired: true,
        requestedMode: "cloud",
      },
    )
    expect(d.mode).toBe("local")
    expect(d.placement).toBe("local")
  })

  test("council requires two providers and falls back when not", () => {
    const d = ModePolicy.resolveMode(
      { council: { enabled: true } },
      {
        localAvailable: true,
        connectedProviderIDs: ["google"],
        requestedMode: "council",
      },
    )
    expect(d.ensemble).toBe(false)
    expect(d.allowed).toBe(false)
    expect(d.mode).toBe("hybrid")
  })

  test("council allowed with two providers", () => {
    const d = ModePolicy.resolveMode(
      { council: { enabled: true } },
      {
        localAvailable: true,
        connectedProviderIDs: ["google", "openrouter"],
        requestedMode: "council",
      },
    )
    expect(d.mode).toBe("council")
    expect(d.ensemble).toBe(true)
    expect(d.allowed).toBe(true)
  })

  test("arena defaults disabled", () => {
    const d = ModePolicy.resolveMode(
      {},
      {
        localAvailable: false,
        connectedProviderIDs: ["a", "b"],
        requestedMode: "arena",
      },
    )
    expect(d.allowed).toBe(false)
    expect(d.mode).toBe("cloud")
  })

  test("arena enabled when configured", () => {
    const d = ModePolicy.resolveMode(
      { arena: { enabled: true } },
      {
        localAvailable: false,
        connectedProviderIDs: ["a", "b", "c"],
        requestedMode: "arena",
      },
    )
    expect(d.mode).toBe("arena")
    expect(d.ensemble).toBe(true)
    expect(d.allowed).toBe(true)
  })

  test("privacy blocks cloud ensemble", () => {
    const d = ModePolicy.resolveMode(
      { council: { enabled: true } },
      {
        localAvailable: true,
        connectedProviderIDs: ["a", "b"],
        privacyRequired: true,
        requestedMode: "council",
      },
    )
    expect(d.allowed).toBe(false)
    expect(d.ensemble).toBe(false)
  })

  test("hybrid escalates high complexity", () => {
    const d = ModePolicy.resolveMode(
      { default: "hybrid" },
      {
        localAvailable: true,
        connectedProviderIDs: ["ax-engine", "google"],
        complexity: "high",
      },
    )
    expect(d.mode).toBe("hybrid")
    expect(d.placement).toBe("cloud")
  })
})
