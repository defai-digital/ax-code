import { describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const require = createRequire(import.meta.url)
const { candidatePackageNames, findBinary } = require("../../bin/binary-selection.cjs") as {
  candidatePackageNames(options?: { platform?: string; arch?: string; avx2?: boolean; musl?: boolean }): {
    binary: string
    names: string[]
    unsupported?: string
  }
  findBinary(startDir: string, options?: { platform?: string; arch?: string; avx2?: boolean; musl?: boolean }): string | undefined
}

describe("binary selection", () => {
  test("prefers baseline musl binaries on non-AVX2 musl Linux x64", () => {
    const selection = candidatePackageNames({ platform: "linux", arch: "x64", avx2: false, musl: true })

    expect(selection.binary).toBe("ax-code")
    expect(selection.names).toEqual([
      "ax-code-linux-x64-baseline-musl",
      "ax-code-linux-x64-musl",
      "ax-code-linux-x64-baseline",
      "ax-code-linux-x64",
    ])
  })

  test("marks Intel macOS as unsupported", () => {
    const selection = candidatePackageNames({ platform: "darwin", arch: "x64", avx2: true })

    expect(selection.names).toEqual([])
    expect(selection.unsupported).toBe("macOS Intel is not supported. ax-code supports macOS arm64 only.")
  })

  test("does not select a Windows baseline package", () => {
    const selection = candidatePackageNames({ platform: "windows", arch: "x64", avx2: false })

    expect(selection.names).toEqual(["ax-code-windows-x64"])
  })

  test("resolves fallback packages in wrapper order", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ax-code-binary-selection-"))
    const binary = path.join(dir, "node_modules", "ax-code-linux-x64", "bin", "ax-code")
    await mkdir(path.dirname(binary), { recursive: true })
    await writeFile(binary, "#!/bin/sh\n")
    await chmod(binary, 0o755)

    expect(findBinary(path.join(dir, "node_modules", "@defai.digital", "ax-code"), {
      platform: "linux",
      arch: "x64",
      avx2: false,
      musl: false,
    })).toBe(binary)
  })
})
