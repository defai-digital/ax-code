import { describe, expect, test } from "vitest"
import type { ComputerAction } from "../src/action"
import {
  AX_COMPUTER_PROTOCOL_MIN_VERSION,
  AX_COMPUTER_PROTOCOL_VERSION,
  AX_COMPUTER_TOOLS,
  ActionResultSchema,
  AppInfoSchema,
  ComputerActionSchema,
  ComputerObservationSchema,
  ObserveScopeSchema,
  PixelImageSchema,
  ProtocolError,
  ProviderCapabilitiesSchema,
  WindowInfoSchema,
  protocolAdvertisement,
  validateProtocolPeer,
  validatePayload,
} from "../src/protocol"
import { PNG_BASE64 } from "./fixtures"

const VALID_OBSERVATION = {
  platform: "darwin",
  provider: "external",
  timestamp: 1760000000000,
  app: { name: "TextEdit", pid: 4242, bundleId: "com.apple.TextEdit" },
  window: { id: "101", title: "Untitled", bounds: { x: 50, y: 50, width: 800, height: 600 } },
  screenshot: { data: PNG_BASE64, mimeType: "image/png", width: 1, height: 1 },
  elements: [{ id: "el-1", role: "AXButton", name: "Save", bounds: { x: 10, y: 20, width: 80, height: 24 } }],
  a11yText: "1 button Save",
  raw: { anything: true },
}

describe("protocol payload schemas", () => {
  test("a full observation round-trips", () => {
    expect(ComputerObservationSchema.parse(VALID_OBSERVATION)).toEqual(VALID_OBSERVATION)
  })

  test("a minimal observation (platform/provider/timestamp/elements only) is valid", () => {
    const minimal = { platform: "test", provider: "external", timestamp: 1, elements: [] }
    expect(ComputerObservationSchema.parse(minimal)).toEqual(minimal)
  })

  test("observations with missing or mistyped required fields are rejected", () => {
    expect(ComputerObservationSchema.safeParse({}).success).toBe(false)
    expect(ComputerObservationSchema.safeParse({ ...VALID_OBSERVATION, elements: "nope" }).success).toBe(false)
    expect(ComputerObservationSchema.safeParse({ ...VALID_OBSERVATION, timestamp: "now" }).success).toBe(false)
    expect(
      ComputerObservationSchema.safeParse({ ...VALID_OBSERVATION, elements: [{ role: "AXButton" }] }).success,
    ).toBe(false)
  })

  test("pixel images require data and mimeType; dimensions stay optional", () => {
    expect(PixelImageSchema.safeParse({ data: PNG_BASE64, mimeType: "image/png" }).success).toBe(true)
    expect(PixelImageSchema.safeParse({ data: PNG_BASE64 }).success).toBe(false)
  })

  test("app and window info mirror the canonical types", () => {
    expect(AppInfoSchema.safeParse({ name: "Finder" }).success).toBe(true)
    expect(AppInfoSchema.safeParse({ pid: 1 }).success).toBe(false)
    expect(
      WindowInfoSchema.safeParse({ id: "1", title: "t", bounds: { x: 0, y: 0, width: 1, height: 1 } }).success,
    ).toBe(true)
    expect(WindowInfoSchema.safeParse({ id: "1", title: "t" }).success).toBe(false)
  })

  test("every canonical action variant validates", () => {
    const actions: ComputerAction[] = [
      { type: "click", target: { kind: "element", id: "el-1" }, button: "left", count: 2 },
      { type: "click", target: { kind: "point", x: 10, y: 20 } },
      { type: "type", text: "hello" },
      { type: "keypress", keys: ["cmd", "s"] },
      { type: "scroll", target: { kind: "element", id: "el-2" }, direction: "down", amount: 1 },
      { type: "scroll", direction: "up" },
      { type: "drag", from: { kind: "point", x: 1, y: 2 }, to: { kind: "point", x: 3, y: 4 } },
      { type: "set_value", target: { kind: "element", id: "el-2" }, value: "x" },
      { type: "activate_window", windowId: "101" },
      { type: "launch_app", app: "TextEdit" },
    ]
    for (const action of actions) {
      expect(ComputerActionSchema.safeParse(action).success, JSON.stringify(action)).toBe(true)
    }
  })

  test("malformed actions are rejected", () => {
    expect(ComputerActionSchema.safeParse({ type: "click" }).success).toBe(false)
    expect(ComputerActionSchema.safeParse({ type: "teleport", target: { kind: "point", x: 1, y: 2 } }).success).toBe(
      false,
    )
    expect(ComputerActionSchema.safeParse({ type: "click", target: { kind: "element" } }).success).toBe(false)
    expect(ComputerActionSchema.safeParse({ type: "click", target: { kind: "point", x: 1 } }).success).toBe(false)
    expect(ComputerActionSchema.safeParse({ type: "keypress", keys: "cmd+s" }).success).toBe(false)
    expect(ComputerActionSchema.safeParse({ type: "scroll", direction: "sideways" }).success).toBe(false)
  })

  test("observe scopes cover app, windowId, and desktop exactly", () => {
    expect(ObserveScopeSchema.safeParse({ app: "TextEdit" }).success).toBe(true)
    expect(ObserveScopeSchema.safeParse({ windowId: "101" }).success).toBe(true)
    expect(ObserveScopeSchema.safeParse({ desktop: true }).success).toBe(true)
    expect(ObserveScopeSchema.safeParse({ desktop: false }).success).toBe(false)
    expect(ObserveScopeSchema.safeParse({}).success).toBe(false)
  })

  test("action results and capabilities validate", () => {
    expect(ActionResultSchema.safeParse({ ok: true, provider: "external", action: "click" }).success).toBe(true)
    expect(
      ActionResultSchema.safeParse({ ok: false, provider: "external", action: "click", refusal: "wrong_target" })
        .success,
    ).toBe(true)
    expect(ActionResultSchema.safeParse({ ok: true, provider: "external", action: "teleport" }).success).toBe(false)
    expect(
      ProviderCapabilitiesSchema.safeParse({
        actions: ["click", "type"],
        backgroundDelivery: false,
        elementTargeting: true,
        windowActivation: false,
      }).success,
    ).toBe(true)
    expect(
      ProviderCapabilitiesSchema.safeParse({ actions: [], backgroundDelivery: true, elementTargeting: true }).success,
    ).toBe(false)
  })

  test("validatePayload folds zod issues into a ProtocolError naming the context", () => {
    try {
      validatePayload(ComputerObservationSchema, { platform: 1 }, "ax_observe result")
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError)
      expect((error as ProtocolError).code).toBe("invalid_payload")
      expect((error as ProtocolError).message).toContain("ax_observe result")
    }
  })
})

describe("canonical tool definitions", () => {
  test("the five canonical tools are defined with JSON-schema inputs", () => {
    expect(AX_COMPUTER_TOOLS.map((tool) => tool.name)).toEqual([
      "ax_capabilities",
      "ax_list_apps",
      "ax_list_windows",
      "ax_observe",
      "ax_act",
    ])
    for (const tool of AX_COMPUTER_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.inputSchema).toBeTypeOf("object")
    }
  })
})

describe("version negotiation", () => {
  test("the client advertisement carries the current version range", () => {
    expect(protocolAdvertisement()).toEqual({
      axComputer: { version: AX_COMPUTER_PROTOCOL_VERSION, minVersion: AX_COMPUTER_PROTOCOL_MIN_VERSION },
    })
  })

  test("a peer in range negotiates successfully", () => {
    expect(validateProtocolPeer({ axComputer: { version: 1, minVersion: 1 } })).toEqual({ version: 1, minVersion: 1 })
    // minVersion defaults to version when the server omits it
    expect(validateProtocolPeer({ axComputer: { version: 1 } })).toEqual({ version: 1, minVersion: 1 })
    // a newer server that still serves this client's version is compatible
    expect(validateProtocolPeer({ axComputer: { version: 7, minVersion: 1 } })).toEqual({ version: 7, minVersion: 1 })
  })

  test("a peer outside the range fails with a clear incompatible-version error", () => {
    let error: ProtocolError | undefined
    try {
      validateProtocolPeer({ protocolVersion: "2024-11-05", axComputer: { version: 99 } })
    } catch (caught) {
      error = caught as ProtocolError
    }
    expect(error).toBeInstanceOf(ProtocolError)
    expect(error?.code).toBe("incompatible_version")
    expect(error?.message).toContain("version mismatch")
    expect(error?.message).toContain("99")
  })

  test("a peer that does not advertise the protocol fails as missing_protocol", () => {
    for (const result of [undefined, null, {}, { protocolVersion: "2024-11-05" }]) {
      let error: ProtocolError | undefined
      try {
        validateProtocolPeer(result)
      } catch (caught) {
        error = caught as ProtocolError
      }
      expect(error, JSON.stringify(result)).toBeInstanceOf(ProtocolError)
      expect(error?.code).toBe("missing_protocol")
      expect(error?.message).toContain("does not advertise the AX Computer protocol")
    }
  })

  test("a malformed advertisement fails as invalid_payload", () => {
    expect(() => validateProtocolPeer({ axComputer: { version: "one" } })).toThrowError(ProtocolError)
    expect(() => validateProtocolPeer({ axComputer: { version: 0 } })).toThrowError(/invalid|validation/i)
  })
})
