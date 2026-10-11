import { expect, test } from "vitest"
import { candidateBinaryTargets } from "../packages/ax-code/script/binary-targets"

test("Windows packaged targets require x64 while Unix ARM remains available", () => {
  const arm = candidateBinaryTargets({ platform: "win32", arch: "arm64", avx2: false })
  expect(arm.names).toEqual([])
  expect(arm.unsupported).toContain("Windows ARM64 is not supported")
  expect(candidateBinaryTargets({ platform: "win32", arch: "x64", avx2: false }).names).toContain("ax-code-windows-x64")
  expect(candidateBinaryTargets({ platform: "darwin", arch: "arm64", avx2: false }).names).toContain(
    "ax-code-darwin-arm64",
  )
  expect(candidateBinaryTargets({ platform: "linux", arch: "arm64", musl: false, avx2: false }).names).toContain(
    "ax-code-linux-arm64",
  )
})
