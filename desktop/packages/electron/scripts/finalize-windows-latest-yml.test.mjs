import { describe, expect, test } from "vitest"
import { parseLatestYml, emitYml, mergeLatestYmls } from "./finalize-windows-latest-yml.mjs"

const x64Yml = `version: 0.9.2
files:
  - url: AX Code Desktop-0.9.2-x64.exe
    sha512: X64SHA==
    size: 92000000
    blockMapSize: 99000
path: AX Code Desktop-0.9.2-x64.exe
sha512: X64SHA==
releaseDate: '2026-06-07T10:00:00.000Z'
`

const arm64Yml = `version: 0.9.2
files:
  - url: AX Code Desktop-0.9.2-arm64.exe
    sha512: ARM64SHA==
    size: 88000000
    blockMapSize: 97000
path: AX Code Desktop-0.9.2-arm64.exe
sha512: ARM64SHA==
releaseDate: '2026-06-07T10:05:00.000Z'
`

describe("parseLatestYml", () => {
  test("parses version and a file entry with numeric size fields", () => {
    const parsed = parseLatestYml(x64Yml)
    expect(parsed.version).toBe("0.9.2")
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0]).toEqual({
      url: "AX Code Desktop-0.9.2-x64.exe",
      sha512: "X64SHA==",
      size: 92000000,
      blockMapSize: 99000,
    })
  })
})

describe("mergeLatestYmls", () => {
  const FIXED_DATE = "2026-06-08T00:00:00.000Z"

  test("combines both arches into one manifest, x64 first (canonical)", () => {
    const merged = mergeLatestYmls([x64Yml, arm64Yml], "0.9.2", FIXED_DATE)
    expect(merged.version).toBe("0.9.2")
    expect(merged.releaseDate).toBe(FIXED_DATE)
    expect(merged.files.map((f) => f.url)).toEqual(["AX Code Desktop-0.9.2-x64.exe", "AX Code Desktop-0.9.2-arm64.exe"])
  })

  test("deduplicates file entries by url", () => {
    const merged = mergeLatestYmls([x64Yml, x64Yml], "0.9.2", FIXED_DATE)
    expect(merged.files).toHaveLength(1)
  })

  test("gracefully handles a single arch (other leg missing)", () => {
    const merged = mergeLatestYmls([x64Yml], "0.9.2", FIXED_DATE)
    expect(merged.files).toHaveLength(1)
    expect(merged.files[0].url).toContain("x64")
  })
})

describe("emitYml", () => {
  test("round-trips a merged manifest back to parseable YAML", () => {
    const merged = mergeLatestYmls([x64Yml, arm64Yml], "0.9.2", "2026-06-08T00:00:00.000Z")
    const reparsed = parseLatestYml(emitYml(merged))
    expect(reparsed.version).toBe("0.9.2")
    expect(reparsed.files).toHaveLength(2)
    // electron-updater treats the first file as the canonical path/sha512.
    expect(reparsed.path).toBe("AX Code Desktop-0.9.2-x64.exe")
    expect(reparsed.sha512).toBe("X64SHA==")
  })
})
