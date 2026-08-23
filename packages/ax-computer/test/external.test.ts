import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { ComputerUseError } from "../src/errors"
import { ProtocolError, protocolAdvertisement } from "../src/protocol"
import { ExternalComputerProvider } from "../src/providers/external"
import { FakeMcpClient } from "./fixtures"

const server = fileURLToPath(new URL("./helpers/fake-ax-server.mjs", import.meta.url))

function spawn(mode: string) {
  return new ExternalComputerProvider({ command: process.execPath, args: [server, mode] })
}

describe("ExternalComputerProvider", () => {
  test("full provider surface against a canonical server", async () => {
    const provider = spawn("basic")
    try {
      // before connect, capabilities() reports the unverified canonical surface
      expect(provider.capabilities().actions).toContain("click")

      const apps = await provider.listApps()
      expect(apps).toEqual([{ name: "TextEdit", pid: 4242, bundleId: "com.apple.TextEdit" }])

      // after connect, capabilities come from ax_capabilities
      expect(provider.capabilities()).toEqual({
        actions: ["click", "type", "keypress", "scroll", "drag", "set_value", "activate_window", "launch_app"],
        backgroundDelivery: true,
        elementTargeting: true,
        windowActivation: true,
      })

      const windows = await provider.listWindows()
      expect(windows[0]).toMatchObject({ id: "101", title: "Untitled" })

      const desktop = await provider.observe({ desktop: true })
      expect(desktop.screenshot?.data).toBeTruthy()
      expect(desktop.elements).toEqual([])

      const scoped = await provider.observe({ app: "TextEdit" })
      expect(scoped.app?.name).toBe("TextEdit")
      expect(scoped.elements.map((element) => element.id)).toEqual(["el-0", "el-1", "el-2"])

      const click = await provider.act({ type: "click", target: { kind: "element", id: "el-1" } })
      expect(click).toEqual({ ok: true, provider: "external", action: "click", detail: "click done" })
    } finally {
      await provider.dispose()
    }
  })

  test("backend refusals map to { ok: false, refusal } results, not throws", async () => {
    const provider = spawn("basic")
    try {
      const result = await provider.act({ type: "launch_app", app: "RefuseMe" })
      expect(result.ok).toBe(false)
      expect(result.action).toBe("launch_app")
      expect(result.refusal).toBe("launch_refused")
    } finally {
      await provider.dispose()
    }
  })

  test("structuredContent.code of a refusal is preserved verbatim on the thrown error", async () => {
    const provider = spawn("refuse-desktop")
    try {
      // desktop scope: structured refusal — the domain code must survive so
      // callers (e.g. the compat suite's app-scope fallback) can react
      const failure = await provider.observe({ desktop: true }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(ComputerUseError)
      expect((failure as ComputerUseError).code).toBe("unsupported_scope")
      expect((failure as ComputerUseError).message).toContain("desktop scope is not supported")
      // app scope still works on the same connection
      const scoped = await provider.observe({ app: "TextEdit" })
      expect(scoped.app?.name).toBe("TextEdit")
    } finally {
      await provider.dispose()
    }
  })

  test("an incompatible server fails the first call with a version-mismatch error", async () => {
    const provider = spawn("incompatible")
    try {
      await expect(provider.listApps()).rejects.toMatchObject({
        name: "ProtocolError",
        code: "incompatible_version",
      })
      await expect(provider.listApps()).rejects.toThrowError(/version mismatch/)
    } finally {
      await provider.dispose()
    }
  })

  test("a server that does not advertise the protocol fails as missing_protocol", async () => {
    const provider = spawn("no-protocol")
    try {
      await expect(provider.listApps()).rejects.toMatchObject({
        name: "ProtocolError",
        code: "missing_protocol",
      })
    } finally {
      await provider.dispose()
    }
  })

  test("a malformed observe payload is rejected by output validation", async () => {
    const provider = spawn("bad-payload")
    try {
      await expect(provider.observe({ desktop: true })).rejects.toMatchObject({
        name: "ProtocolError",
        code: "invalid_payload",
      })
      await expect(provider.observe({ desktop: true })).rejects.toThrowError(/ax_observe/)
    } finally {
      await provider.dispose()
    }
  })

  test("requests are validated before they reach the server", async () => {
    const client = new FakeMcpClient(() => ({}))
    const provider = new ExternalComputerProvider({ client, initializeResult: protocolAdvertisement() })
    // invalid action: no target — must fail without a single MCP call
    await expect(provider.act({ type: "click" } as never)).rejects.toBeInstanceOf(ProtocolError)
    expect(client.calls).toEqual([])
    // invalid scope likewise
    await expect(provider.observe({} as never)).rejects.toBeInstanceOf(ProtocolError)
    expect(client.calls).toEqual([])
  })

  test("an injected client still negotiates the protocol version", async () => {
    const client = new FakeMcpClient(() => ({}))
    const provider = new ExternalComputerProvider({ client, initializeResult: { axComputer: { version: 99 } } })
    await expect(provider.listApps()).rejects.toMatchObject({ code: "incompatible_version" })
    // negotiation failed before any tool call went out
    expect(client.calls).toEqual([])
  })

  test("dispose closes the underlying client", async () => {
    const client = new FakeMcpClient((tool) =>
      tool === "ax_capabilities"
        ? {
            structuredContent: {
              actions: ["click"],
              backgroundDelivery: false,
              elementTargeting: true,
              windowActivation: false,
            },
          }
        : { structuredContent: { apps: [] } },
    )
    const provider = new ExternalComputerProvider({ client, initializeResult: protocolAdvertisement() })
    expect(await provider.listApps()).toEqual([])
    expect(provider.capabilities().actions).toEqual(["click"])
    await provider.dispose()
    expect(client.closed).toBe(true)
  })
})
