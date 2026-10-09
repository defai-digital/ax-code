import { expect, test } from "vitest"
import { supportsNodeVersion, nodeSupportMessage } from "./check-node-version.mjs"

test.each(["18.20.8", "20.19.0", "22.18.0", "24.21.0", "25.9.0", "invalid", "26", "Infinity.0.0"])(
  "rejects unsupported Node version %s",
  (version) => expect(supportsNodeVersion(version)).toBe(false),
)

test.each(["26.0.0", "26.11.0", "v26.11.0", "27.0.0", "28.1.2"])("accepts supported Node version %s", (version) => {
  expect(supportsNodeVersion(version)).toBe(true)
})

test("explains how to fix an unsupported runtime", () => {
  expect(nodeSupportMessage("24.21.0")).toContain("Node.js 26 or later")
  expect(nodeSupportMessage("24.21.0")).toContain("found 24.21.0")
})
