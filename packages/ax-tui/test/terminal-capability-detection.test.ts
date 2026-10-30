import { expect, test } from "vitest"
import { isCapabilityResponse, isPixelResolutionResponse, parsePixelResolution } from "../src/lib/terminal-capability-detection.js"

test("detects kitty OSC 99 notification capability responses", () => {
  expect(isCapabilityResponse("\x1b]99;i=ax-tui-notifications:p=?;\x07")).toBe(true)
  expect(isCapabilityResponse("\x1b]99;i=ax-tui-notifications:p=?;\x1b\\")).toBe(true)
  expect(isCapabilityResponse("\x1b]99;o=always;i=ax-tui-notifications:p=?;x=1\x07")).toBe(true)
  expect(isCapabilityResponse("\x1b]99;i=other-app:p=?;\x07")).toBe(false)
  // Missing the p=? capability query marker.
  expect(isCapabilityResponse("\x1b]99;i=ax-tui-notifications\x07")).toBe(false)
})

test("OSC 99 matching stays linear on repeated marker text", () => {
  const hostile = "\x1b]99;" + "i=ax-tui-notifications".repeat(2_000)
  expect(isCapabilityResponse(hostile)).toBe(false)
})

test("OSC 99 detection requires a complete response within one control sequence", () => {
  expect(isCapabilityResponse("\x1b]99;i=ax-tui-notifications:p=?;")).toBe(false)
  expect(isCapabilityResponse("\x1b]99;i=ax-tui-notifications:p=?;\x1b")).toBe(false)
  expect(isCapabilityResponse("\x1b]99;i=ax-tui-notifications\x1b]99;p=?;\x07")).toBe(false)
  expect(isCapabilityResponse("\x1b]99;i=ax-tui-notifications\x1b[0mp=?;\x07")).toBe(false)
  expect(isCapabilityResponse("\x1b]99;incomplete\x1b]99;i=ax-tui-notifications:p=?;\x07")).toBe(true)
  expect(isCapabilityResponse("\x1b]99;".repeat(20_000))).toBe(false)
})

test("detects XTVersion, kitty graphics, iterm2, DECRPM, CPR, and DA1 responses", () => {
  expect(isCapabilityResponse("\x1bP>|XTerm(354)\x1b\\")).toBe(true)
  expect(isCapabilityResponse("\x1b_Gi=1;OK\x1b\\")).toBe(true)
  expect(isCapabilityResponse("\x1b]1337;Capabilities=T\x07")).toBe(true)
  expect(isCapabilityResponse("\x1b[?1;2$y")).toBe(true)
  expect(isCapabilityResponse("\x1b[1;3R")).toBe(true)
  expect(isCapabilityResponse("\x1b[?62;c")).toBe(true)
  expect(isCapabilityResponse("plain text")).toBe(false)
})

test("repeated-prefix capability probes do not backtrack", () => {
  expect(isCapabilityResponse("\x1bP>|".repeat(2_000))).toBe(false)
  expect(isCapabilityResponse("\x1b_G".repeat(2_000))).toBe(false)
  expect(isCapabilityResponse("\x1b]1337;Capabilities=".repeat(2_000))).toBe(false)
})

test("pixel resolution responses parse", () => {
  expect(isPixelResolutionResponse("\x1b[4;800;1200t")).toBe(true)
  expect(parsePixelResolution("\x1b[4;800;1200t")).toEqual({ width: 1200, height: 800 })
  expect(parsePixelResolution("nope")).toBeNull()
})
