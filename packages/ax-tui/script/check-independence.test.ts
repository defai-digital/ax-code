import { expect, test } from "vitest"
import { checkIndependence, hasUpstreamRuntimeCoupling } from "./check-independence.js"

test("source, generated runtime, dependency graph, and native build are independent", () => {
  expect(checkIndependence()).toEqual([])
})

test("the independence guard detects operational coupling while preserving attribution", () => {
  for (const code of [
    'import { render } from "@opentui/solid"',
    'await import("@opentui/core-linux-x64")',
    'env.get("OPENTUI_GRAPHICS")',
    'const library = "libopentui.so"',
    'const library = "opentui.dll"',
    'const query = "opentui-notifications"',
  ])
    expect(hasUpstreamRuntimeCoupling(code), code).toBe(true)
  expect(hasUpstreamRuntimeCoupling("Copyright (c) 2025 opentui")).toBe(false)
  expect(hasUpstreamRuntimeCoupling("static createForOpenTUI() { return Node.createForAxTui() }")).toBe(false)
})
