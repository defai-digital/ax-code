import { describe, expect, test } from "vitest"
import { recordSlashUse, slashScore, SLASH_FRECENCY_CAP, topSlashRecents } from "@/cli/cmd/tui/component/slash-frecency"

const HOUR = 3_600_000
const NOW = 1_700_000_000_000

describe("slashScore", () => {
  test("very-recent use scores ≈ count", () => {
    // 0 hours since use → count / (1 + 0) = count
    expect(slashScore({ count: 5, lastUsed: NOW }, NOW)).toBe(5)
  })

  test("aging halves score by an hour-scale factor", () => {
    // 1 hour: 5 / 2 = 2.5
    expect(slashScore({ count: 5, lastUsed: NOW - HOUR }, NOW)).toBeCloseTo(2.5)
    // 24 hours: 5 / 25 = 0.2
    expect(slashScore({ count: 5, lastUsed: NOW - 24 * HOUR }, NOW)).toBeCloseTo(0.2)
  })

  test("future timestamps clamp to zero hours (no negative aging)", () => {
    expect(slashScore({ count: 3, lastUsed: NOW + HOUR }, NOW)).toBe(3)
  })

  test("corrupted entry (NaN count or lastUsed) does not poison ordering", () => {
    // A hand-edited or partial-write kv.json could leave non-finite values;
    // without the guard, sort comparison becomes undefined. We only require
    // the score is finite — exact value doesn't matter, the entry just
    // needs to compare cleanly so sort doesn't blow up.
    expect(Number.isFinite(slashScore({ count: NaN as any, lastUsed: NOW }, NOW))).toBe(true)
    expect(Number.isFinite(slashScore({ count: 5, lastUsed: NaN as any }, NOW))).toBe(true)
    expect(Number.isFinite(slashScore({ count: undefined as any, lastUsed: undefined as any }, NOW))).toBe(true)
    // NaN-count specifically falls back to 0
    expect(slashScore({ count: NaN as any, lastUsed: NOW }, NOW)).toBe(0)
  })
})

describe("recordSlashUse", () => {
  test("creates entry on first use", () => {
    const next = recordSlashUse(undefined, "/status", NOW)
    expect(next["/status"]).toEqual({ count: 1, lastUsed: NOW })
  })

  test("increments existing entry and updates lastUsed", () => {
    const next = recordSlashUse({ "/status": { count: 2, lastUsed: NOW - HOUR } }, "/status", NOW)
    expect(next["/status"]).toEqual({ count: 3, lastUsed: NOW })
  })

  test("evicts weakest entry when over cap", () => {
    const map: Record<string, { count: number; lastUsed: number }> = {}
    // Fill to cap - 1 strong entries; the stale one takes the last slot
    // so the map is exactly at cap before the new insert. Inserting
    // /fresh pushes it over, eviction trims back to cap.
    for (let i = 0; i < SLASH_FRECENCY_CAP - 1; i++) {
      map[`/cmd${i}`] = { count: 10, lastUsed: NOW }
    }
    map["/stale"] = { count: 1, lastUsed: NOW - 24 * HOUR }
    const result = recordSlashUse(map, "/fresh", NOW)
    expect(Object.keys(result).length).toBe(SLASH_FRECENCY_CAP)
    // The stale entry should be the one removed (lowest score among non-fresh)
    expect(result["/stale"]).toBeUndefined()
    expect(result["/fresh"]).toEqual({ count: 1, lastUsed: NOW })
  })

  test("never evicts the just-touched entry", () => {
    // Touching a key when the map is already full of stronger entries:
    // the touched key wins because we explicitly skip it in eviction.
    const map: Record<string, { count: number; lastUsed: number }> = {}
    for (let i = 0; i < SLASH_FRECENCY_CAP; i++) {
      map[`/cmd${i}`] = { count: 100, lastUsed: NOW }
    }
    const result = recordSlashUse(map, "/cmd0", NOW)
    expect(result["/cmd0"]).toBeDefined()
    expect(Object.keys(result).length).toBe(SLASH_FRECENCY_CAP)
  })
})

describe("topSlashRecents", () => {
  const available = new Set(["/status", "/clear", "/loop"])

  test("returns empty for undefined map", () => {
    expect(topSlashRecents(undefined, available)).toEqual([])
  })

  test("sorts by score and limits", () => {
    const map = {
      "/status": { count: 10, lastUsed: NOW },
      "/clear": { count: 2, lastUsed: NOW },
      "/loop": { count: 5, lastUsed: NOW },
    }
    expect(topSlashRecents(map, available, 3, NOW)).toEqual(["/status", "/loop", "/clear"])
    expect(topSlashRecents(map, available, 2, NOW)).toEqual(["/status", "/loop"])
  })

  test("filters out unregistered commands", () => {
    // /removed is in the frecency map but not in available — must not appear
    const map = {
      "/status": { count: 5, lastUsed: NOW },
      "/removed": { count: 100, lastUsed: NOW },
    }
    expect(topSlashRecents(map, available, 3, NOW)).toEqual(["/status"])
  })
})
