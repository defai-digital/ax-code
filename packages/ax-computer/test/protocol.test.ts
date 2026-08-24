import { describe, expect, test } from "vitest"
import type { ComputerAction } from "../src/action"
import {
  AX_COMPUTER_PROTOCOL_MIN_VERSION,
  AX_COMPUTER_PROTOCOL_VERSION,
  AX_COMPUTER_TOOLS,
  ActArgsSchema,
  ActionResultSchema,
  AppInfoSchema,
  ComputerActionSchema,
  ComputerObservationSchema,
  ObserveArgsSchema,
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

  test("passive observe args: waitMs/have require sinceRevision; bounds enforced", () => {
    const scope = { app: "TextEdit" }
    const hash = `sha256:${"a".repeat(64)}`
    // legacy observe (scope only) and both passive forms are valid
    expect(ObserveArgsSchema.safeParse({ scope }).success).toBe(true)
    expect(ObserveArgsSchema.safeParse({ scope, sinceRevision: null }).success).toBe(true)
    expect(ObserveArgsSchema.safeParse({ scope, sinceRevision: "r1", waitMs: 1_000, have: [hash] }).success).toBe(true)
    // waitMs/have without sinceRevision are rejected
    expect(ObserveArgsSchema.safeParse({ scope, waitMs: 1 }).success).toBe(false)
    expect(ObserveArgsSchema.safeParse({ scope, have: [hash] }).success).toBe(false)
    // revision token and waitMs bounds
    expect(ObserveArgsSchema.safeParse({ scope, sinceRevision: "" }).success).toBe(false)
    expect(ObserveArgsSchema.safeParse({ scope, sinceRevision: "x".repeat(97) }).success).toBe(false)
    expect(ObserveArgsSchema.safeParse({ scope, sinceRevision: "r1", waitMs: -1 }).success).toBe(false)
    expect(ObserveArgsSchema.safeParse({ scope, sinceRevision: "r1", waitMs: 5_001 }).success).toBe(false)
    expect(ObserveArgsSchema.safeParse({ scope, sinceRevision: "r1", waitMs: 5_000 }).success).toBe(true)
    // frame hashes must be canonical sha256; the have list is bounded
    expect(ObserveArgsSchema.safeParse({ scope, sinceRevision: null, have: ["sha256:zz"] }).success).toBe(false)
    expect(ObserveArgsSchema.safeParse({ scope, sinceRevision: null, have: Array(65).fill(hash) }).success).toBe(false)
    expect(ObserveArgsSchema.safeParse({ scope, sinceRevision: null, have: Array(64).fill(hash) }).success).toBe(true)
  })

  test("passive observation fields are optional and frameHash is validated", () => {
    const passive = {
      platform: "test",
      provider: "external",
      timestamp: 1,
      elements: [],
      revision: "r1",
      frameHash: `sha256:${"b".repeat(64)}`,
    }
    expect(ComputerObservationSchema.safeParse(passive).success).toBe(true)
    expect(ComputerObservationSchema.safeParse({ ...passive, unchanged: true, gap: true }).success).toBe(true)
    expect(ComputerObservationSchema.safeParse({ ...passive, frameHash: "sha256:nope" }).success).toBe(false)
    // legacy observations carry none of the passive fields and still validate
    expect(ComputerObservationSchema.parse(VALID_OBSERVATION)).toEqual(VALID_OBSERVATION)
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

  test("move and wait action variants validate", () => {
    const actions: ComputerAction[] = [
      { type: "move", target: { kind: "element", id: "el-1" } },
      { type: "move", target: { kind: "point", x: 10, y: 20 } },
      { type: "wait", condition: { type: "element_visible", target: { kind: "element", id: "el-1" } } },
      { type: "wait", condition: { type: "element_enabled", target: { kind: "element", id: "el-1" } } },
      { type: "wait", condition: { type: "value_matches", target: { kind: "element", id: "el-2" }, value: "x" } },
      { type: "wait", condition: { type: "screen_stable" }, timeoutMs: 5_000, pollMs: 250 },
    ]
    for (const action of actions) {
      expect(ComputerActionSchema.safeParse(action).success, JSON.stringify(action)).toBe(true)
    }
  })

  test("element-only wait conditions reject point targets; pollMs has a floor", () => {
    for (const condition of [
      { type: "element_visible", target: { kind: "point", x: 1, y: 2 } },
      { type: "element_enabled", target: { kind: "point", x: 1, y: 2 } },
      { type: "value_matches", target: { kind: "point", x: 1, y: 2 }, value: "x" },
    ]) {
      expect(ComputerActionSchema.safeParse({ type: "wait", condition }).success, JSON.stringify(condition)).toBe(false)
    }
    expect(
      ComputerActionSchema.safeParse({ type: "wait", condition: { type: "screen_stable" }, pollMs: 10 }).success,
    ).toBe(false)
    expect(
      ComputerActionSchema.safeParse({ type: "wait", condition: { type: "screen_stable" }, timeoutMs: -1 }).success,
    ).toBe(false)
  })

  test("ax_act args require exactly one of action/actions, bounded to 25 steps", () => {
    const click = { type: "click", target: { kind: "point", x: 1, y: 2 } }
    expect(ActArgsSchema.safeParse({ action: click }).success).toBe(true)
    expect(ActArgsSchema.safeParse({ actions: [click], stopOnError: false }).success).toBe(true)
    // neither, both, empty batch, and oversized batch are all rejected
    expect(ActArgsSchema.safeParse({}).success).toBe(false)
    expect(ActArgsSchema.safeParse({ action: click, actions: [click] }).success).toBe(false)
    expect(ActArgsSchema.safeParse({ actions: [] }).success).toBe(false)
    expect(ActArgsSchema.safeParse({ actions: Array.from({ length: 26 }, () => click) }).success).toBe(false)
    expect(ActArgsSchema.safeParse({ actions: Array.from({ length: 25 }, () => click) }).success).toBe(true)
  })

  test("action results carry optional per-step batch outcomes", () => {
    expect(
      ActionResultSchema.safeParse({
        ok: false,
        provider: "external",
        action: "click",
        refusal: "unknown_element",
        results: [
          { index: 0, ok: true },
          { index: 1, ok: false, refusal: "unknown_element", detail: "no such element" },
        ],
      }).success,
    ).toBe(true)
    expect(
      ActionResultSchema.safeParse({ ok: true, provider: "external", action: "click", results: [{ ok: true }] })
        .success,
    ).toBe(false)
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
