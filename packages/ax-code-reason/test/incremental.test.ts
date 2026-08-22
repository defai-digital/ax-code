import { describe, expect, test } from "vitest"
import { computeObsoleteFindings, shouldFallbackToFull, type IncrementalContext } from "../src/incremental"
import type { SourceState } from "../src/quality/freshness"

// ─── Seeded RNG (mulberry32) — deterministic, no external dependencies ─────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Deterministic "scan" model ────────────────────────────────────────────
//
// A finding is derived only from its file (path hash), never from mutable
// state, so at a fixed revision an unchanged file always yields identical
// findings — the invariant incremental equivalence relies on.

type FakeFinding = { file: string; line: number; value: string }

function scanFiles(files: readonly string[]): FakeFinding[] {
  const out: FakeFinding[] = []
  for (const file of files) {
    let h = 0
    for (let i = 0; i < file.length; i++) h = (h * 31 + file.charCodeAt(i)) >>> 0
    const count = (h % 4) + 1
    for (let k = 0; k < count; k++) out.push({ file, line: k + 1, value: `${file}#${k}` })
  }
  return out
}

function sortFindings(findings: FakeFinding[]): FakeFinding[] {
  return [...findings].sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))
}

function ctx(revision: string | null, source: SourceState | null): IncrementalContext {
  return { revision, source }
}

const fresh: SourceState = { available: true, commit: "c1", dirtyDigest: "d1" }

describe("shouldFallbackToFull", () => {
  test("identical context does not fall back", () => {
    expect(shouldFallbackToFull(ctx("r1", fresh), ctx("r1", fresh))).toBe(false)
  })

  test("null current revision falls back", () => {
    expect(shouldFallbackToFull(ctx("r1", fresh), ctx(null, fresh))).toBe(true)
  })

  test("null prior revision falls back", () => {
    expect(shouldFallbackToFull(ctx(null, fresh), ctx("r1", fresh))).toBe(true)
  })

  test("revision move or regress falls back", () => {
    expect(shouldFallbackToFull(ctx("r1", fresh), ctx("r2", fresh))).toBe(true)
    expect(shouldFallbackToFull(ctx("r2", fresh), ctx("r1", fresh))).toBe(true)
  })

  test("missing source on either side falls back", () => {
    expect(shouldFallbackToFull(ctx("r1", null), ctx("r1", fresh))).toBe(true)
    expect(shouldFallbackToFull(ctx("r1", fresh), ctx("r1", null))).toBe(true)
  })

  test("source availability / commit / dirty-digest drift falls back", () => {
    expect(shouldFallbackToFull(ctx("r1", fresh), ctx("r1", { ...fresh, commit: "c2" }))).toBe(true)
    expect(shouldFallbackToFull(ctx("r1", fresh), ctx("r1", { ...fresh, dirtyDigest: "d2" }))).toBe(true)
    expect(
      shouldFallbackToFull(ctx("r1", fresh), ctx("r1", { available: false, commit: null, dirtyDigest: null })),
    ).toBe(true)
  })
})

describe("computeObsoleteFindings", () => {
  test("returns findings whose file is in the changed set (array or Set)", () => {
    const findings = scanFiles(["/repo/a.ts", "/repo/b.ts", "/repo/c.ts"])
    const obsolete = computeObsoleteFindings(findings, ["/repo/b.ts"])
    expect(obsolete.every((f) => f.file === "/repo/b.ts")).toBe(true)
    expect(obsolete.length).toBe(findings.filter((f) => f.file === "/repo/b.ts").length)

    const viaSet = computeObsoleteFindings(findings, new Set(["/repo/a.ts", "/repo/c.ts"]))
    expect(viaSet.every((f) => f.file !== "/repo/b.ts")).toBe(true)
  })

  test("empty changed set removes nothing", () => {
    const findings = scanFiles(["/repo/a.ts"])
    expect(computeObsoleteFindings(findings, [])).toEqual([])
  })
})

describe("incremental equivalence property (seeded)", () => {
  test("incremental(changed ∪ importers) ∪ full(unchanged) ≡ full(all) at fixed revision", () => {
    const rng = mulberry32(0xdecafbad)
    const all = Array.from({ length: 24 }, (_, i) => `/repo/src/module_${i}.ts`)

    for (let trial = 0; trial < 300; trial++) {
      // Randomly partition `all` into the rescan set (changed ∪ importers).
      const changed = all.filter(() => rng() < 0.3)
      const importers = all.filter((f) => !changed.includes(f) && rng() < 0.2)
      const rescanSet = new Set([...changed, ...importers])

      const full = scanFiles(all)
      const previous = full // the prior full run at the same revision
      const obsolete = computeObsoleteFindings(previous, rescanSet)
      const carriedOver = previous.filter((f) => !rescanSet.has(f.file))
      const rescanned = scanFiles([...rescanSet])
      const incremental = [...carriedOver, ...rescanned]

      // Equivalence: the incremental result matches a clean full run.
      expect(sortFindings(incremental)).toEqual(sortFindings(full))

      // Obsolete findings are exactly the previous findings for rescan-set
      // files (never more, never fewer).
      expect(sortFindings(obsolete)).toEqual(sortFindings(previous.filter((f) => rescanSet.has(f.file))))
    }
  })

  test("obsolete findings for changed files are removed from the carried-over set", () => {
    const rng = mulberry32(0x1234abcd)
    const all = Array.from({ length: 10 }, (_, i) => `/repo/src/f${i}.ts`)
    const changed = all.filter(() => rng() < 0.4)
    const changedSet = new Set(changed)

    const previous = scanFiles(all)
    const carriedOver = previous.filter((f) => !computeObsoleteFindings(previous, changedSet).includes(f))

    // No carried-over finding belongs to a changed file.
    for (const f of carriedOver) expect(changedSet.has(f.file)).toBe(false)
  })
})
