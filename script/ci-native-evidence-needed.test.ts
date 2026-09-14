import { expect, test } from "vitest"
import { nativeEvidenceNeeded } from "./ci-native-evidence-needed"

test("skips ordinary core JavaScript changes", () => {
  expect(nativeEvidenceNeeded(["packages/ax-code/src/session/goal-plan-baseline.ts"])).toBe(false)
  expect(nativeEvidenceNeeded(["packages/ax-code/test/session/goal-plan-baseline.test.ts"])).toBe(false)
  expect(nativeEvidenceNeeded(["docs/guides/evidence-cache.md"])).toBe(false)
})

test("rebuilds when native evidence inputs change", () => {
  expect(nativeEvidenceNeeded(["crates/ax-code-fs/src/evidence.rs"])).toBe(true)
  expect(nativeEvidenceNeeded(["crates/Cargo.lock"])).toBe(true)
  expect(nativeEvidenceNeeded(["packages/ax-code-fs-native/index.js"])).toBe(true)
  expect(nativeEvidenceNeeded(["script/build-native.ts"])).toBe(true)
  expect(nativeEvidenceNeeded(["script/verify-evidence-cache.cjs"])).toBe(true)
  expect(nativeEvidenceNeeded([".github/actions/build-evidence-cache/action.yml"])).toBe(true)
  expect(nativeEvidenceNeeded([".github/workflows/ax-code-ci.yml"])).toBe(true)
  expect(nativeEvidenceNeeded(["pnpm-lock.yaml"])).toBe(true)
  expect(nativeEvidenceNeeded(["package.json"])).toBe(true)
  expect(nativeEvidenceNeeded(["rust-toolchain.toml"])).toBe(true)
})
