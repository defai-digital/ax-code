import { describe, expect, test } from "vitest"
import { OsSandbox } from "../../src/isolation/os-sandbox"
import { EgressProxy } from "../../src/isolation/egress-proxy"
import { Isolation } from "../../src/isolation"
import { getEgressCheck } from "../../src/cli/cmd/doctor-egress"

describe("Seatbelt egress allowlist profile (ADR-232)", () => {
  test("permits outbound only to the proxy loopback port", () => {
    const profile = OsSandbox.buildSeatbeltProfile({
      workspaceRoot: "/Users/dev/proj",
      network: true,
      egressPort: 51234,
    })
    expect(profile).toContain("(deny network*)")
    expect(profile).toContain("(deny network-outbound)")
    expect(profile).toContain('(allow network-outbound (remote ip "127.0.0.1:51234"))')
    // The blanket allow must not survive alongside the egress rule.
    expect(profile).not.toContain("(allow network*)")
  })

  test("keeps the blanket allow when no egress port is given", () => {
    const profile = OsSandbox.buildSeatbeltProfile({ workspaceRoot: "/Users/dev/proj", network: true })
    expect(profile).toContain("(allow network*)")
    expect(profile).not.toContain("remote ip")
  })

  test("full network deny is unaffected by an absent egress port", () => {
    const profile = OsSandbox.buildSeatbeltProfile({ workspaceRoot: "/Users/dev/proj", network: false })
    expect(profile).toContain("(deny network*)")
    expect(profile).not.toContain("remote ip")
  })
})

describe("egress proxy env wiring", () => {
  test("points the child at the loopback proxy and keeps loopback direct", () => {
    const env = EgressProxy.proxyEnv(49152)
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:49152")
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:49152")
    expect(env.ALL_PROXY).toBe("http://127.0.0.1:49152")
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1,::1")
  })
})

describe("Isolation egress state", () => {
  test("object config form enables network and carries the allowlist", () => {
    const state = Isolation.resolve(
      { mode: "workspace-write", network: { allowed_domains: ["registry.npmjs.org"], denied_domains: ["evil.test"] } },
      "/tmp",
    )
    expect(state.network).toBe(true)
    expect(state.allowedDomains).toEqual(["registry.npmjs.org"])
    expect(state.deniedDomains).toEqual(["evil.test"])
    expect(Isolation.egressConfigured(state)).toBe(true)
  })

  test("boolean config form carries no allowlist", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: true }, "/tmp")
    expect(state.network).toBe(true)
    expect(state.allowedDomains).toBeUndefined()
    expect(Isolation.egressConfigured(state)).toBe(false)
  })

  test("an object config with an empty allowlist is not an allowlist", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: {} }, "/tmp")
    expect(Isolation.egressConfigured(state)).toBe(false)
  })

  test("full-access never reports a configured allowlist", () => {
    const state = Isolation.resolve({ mode: "full-access", network: { allowed_domains: ["example.com"] } }, "/tmp")
    expect(Isolation.egressConfigured(state)).toBe(false)
  })

  test("enforcement is platform-dependent", () => {
    const state = Isolation.resolve({ mode: "workspace-write", network: { allowed_domains: ["example.com"] } }, "/tmp")
    expect(Isolation.egressEnforcement(state, "darwin")).toBe("enforced")
    expect(Isolation.egressEnforcement(state, "linux")).toBe("advisory")
    expect(Isolation.egressEnforcement(state, "win32")).toBe("unsupported")
    expect(Isolation.egressEnforcement(undefined, "darwin")).toBe("off")
  })
})

describe("doctor network egress row", () => {
  test("reports not-configured when no allowlist is set", () => {
    const check = getEgressCheck({})
    expect(check.name).toBe("Network egress")
    expect(check.status).toBe("ok")
    expect(check.detail).toContain("not configured")
  })

  test("reports enforced on darwin", () => {
    const check = getEgressCheck({
      config: { allowed_domains: ["example.com"] },
      mode: "workspace-write",
      platform: "darwin",
    })
    expect(check.status).toBe("ok")
    expect(check.detail).toContain("enforced")
  })

  test("reports advisory on linux", () => {
    const check = getEgressCheck({
      config: { allowed_domains: ["example.com"] },
      mode: "workspace-write",
      platform: "linux",
    })
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("advisory")
  })

  test("reports unsupported on windows", () => {
    const check = getEgressCheck({
      config: { allowed_domains: ["example.com"] },
      mode: "workspace-write",
      platform: "win32",
    })
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("unsupported")
  })

  test("warns when the sandbox is off", () => {
    const check = getEgressCheck({
      config: { allowed_domains: ["example.com"] },
      mode: "full-access",
      platform: "darwin",
    })
    expect(check.status).toBe("warn")
    expect(check.detail).toContain("full-access")
  })
})
