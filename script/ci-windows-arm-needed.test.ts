import { expect, test } from "vitest"
import { windowsArmRuntimeNeeded } from "./ci-windows-arm-needed"

test("skips ordinary core JavaScript changes", () => {
  expect(windowsArmRuntimeNeeded(["packages/ax-code/src/session/goal-plan-baseline.ts"])).toBe(false)
  expect(windowsArmRuntimeNeeded(["packages/ax-code/src/cli/tui/renderer.ts"])).toBe(false)
  expect(windowsArmRuntimeNeeded(["docs/guides/windows-runtime-integrity.md"])).toBe(false)
})

test("qualifies windows-11-arm when the PTY runtime inputs change", () => {
  expect(windowsArmRuntimeNeeded(["script/rebuild-node-pty.mjs"])).toBe(true)
  expect(windowsArmRuntimeNeeded(["script/verify-pty.cjs"])).toBe(true)
  expect(windowsArmRuntimeNeeded(["patches/node-pty-prebuilt-multiarch@0.10.1-pre.5.patch"])).toBe(true)
  expect(windowsArmRuntimeNeeded([".github/workflows/ax-code-ci.yml"])).toBe(true)
  expect(windowsArmRuntimeNeeded([".github/scripts/assert-windows-pty-build.cjs"])).toBe(true)
  expect(windowsArmRuntimeNeeded(["pnpm-lock.yaml"])).toBe(true)
  expect(windowsArmRuntimeNeeded(["pnpm-workspace.yaml"])).toBe(true)
  expect(windowsArmRuntimeNeeded(["packages/ax-code/src/pty/index.ts"])).toBe(true)
  expect(windowsArmRuntimeNeeded(["packages/ax-code/src/cli/bootstrap/windows-console.ts"])).toBe(true)
  expect(windowsArmRuntimeNeeded(["packages/ax-code/test/snapshot/windows-paths.test.ts"])).toBe(true)
  expect(windowsArmRuntimeNeeded(["packages/ax-code/test/tool/bash-process-cleanup-native.test.ts"])).toBe(true)
})
