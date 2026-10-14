import { describe, expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import {
  CINEMA_FADE_IN_MS,
  CINEMA_FADE_OUT_MS,
  CINEMA_STILL,
  CINEMA_ZOOM_MAX,
  CINEMA_ZOOM_MIN,
  applyCinema,
  chooseCinemaMove,
  cinemaShot,
  type CinemaMove,
  type CinemaMoveKind,
} from "../../../src/cli/tui/component/scene-cinema"
import {
  SCENE_FRAME_BUDGET_MS,
  SCENE_MIN_QUALITY,
  SCENE_PIXEL_BUDGET,
  digitalCodePixelPlayer,
  nextSceneQuality,
  sceneQualityCeiling,
  sceneRasterSize,
} from "../../../src/cli/tui/component/digital-code-pixels"

const KINDS: CinemaMoveKind[] = ["still", "push-in", "pull-back", "drift-left", "drift-right"]
const PUSH: CinemaMove = { kind: "push-in", zoom: 1.08, ease: "in-out", focusX: 0.6, focusY: -0.5 }
const PULL: CinemaMove = { ...PUSH, kind: "pull-back" }
const shot = (elapsedMs: number, move: CinemaMove = PULL) =>
  cinemaShot({ width: 320, height: 180, elapsedMs, durationMs: 3000, move })

/** Deterministic pseudo-random stream for draws. */
function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function solid(w: number, h: number, rgb: [number, number, number]) {
  const buffer = Buffer.alloc(w * h * 3)
  for (let i = 0; i < buffer.length; i += 3) {
    buffer[i] = rgb[0]
    buffer[i + 1] = rgb[1]
    buffer[i + 2] = rgb[2]
  }
  return buffer
}

const pixel = (buffer: Buffer, w: number, x: number, y: number) => {
  const i = (y * w + x) * 3
  return [buffer[i]!, buffer[i + 1]!, buffer[i + 2]!]
}

describe("cinema shot", () => {
  test("fades in from black and out to black within the playback", () => {
    expect(shot(0).exposure).toBe(0)
    expect(shot(CINEMA_FADE_IN_MS / 2).exposure).toBeGreaterThan(0)
    expect(shot(CINEMA_FADE_IN_MS / 2).exposure).toBeLessThan(1)
    expect(shot(1500).exposure).toBe(1)
    expect(shot(3000 - CINEMA_FADE_OUT_MS / 2).exposure).toBeLessThan(1)
    expect(shot(3000).exposure).toBe(0)
    expect(shot(5000).exposure).toBe(0)
  })

  test("draws every kind, with still the most common, and varies depth, pacing and focus", () => {
    const random = seeded(7)
    const moves = Array.from({ length: 2000 }, () => chooseCinemaMove(random))
    const count = (kind: CinemaMoveKind) => moves.filter((move) => move.kind === kind).length
    for (const kind of KINDS) expect(count(kind)).toBeGreaterThan(0)
    for (const kind of KINDS.slice(1)) expect(count("still")).toBeGreaterThan(count(kind))
    const moving = moves.filter((move) => move.kind !== "still")
    for (const move of moving) {
      expect(move.zoom).toBeGreaterThanOrEqual(CINEMA_ZOOM_MIN)
      expect(move.zoom).toBeLessThanOrEqual(CINEMA_ZOOM_MAX)
      expect(Math.abs(move.focusX)).toBeLessThanOrEqual(1)
      expect(Math.abs(move.focusY)).toBeLessThanOrEqual(1)
    }
    expect(new Set(moving.map((move) => move.ease)).size).toBe(4)
    expect(new Set(moving.map((move) => move.zoom.toFixed(3))).size).toBeGreaterThan(20)
    expect(new Set(moving.map((move) => move.focusX.toFixed(2))).size).toBeGreaterThan(20)
    expect(chooseCinemaMove(() => 0)).toBe(CINEMA_STILL)
    expect(chooseCinemaMove(() => 0.999999).kind).toBe("drift-right")
  })

  test("still holds the full frame; push-in closes in; pull-back reveals", () => {
    for (let t = 0; t <= 3000; t += 250) {
      const still = shot(t, CINEMA_STILL)
      expect(still.zoom).toBe(1)
      expect(still.centerX).toBe(160)
      expect(still.centerY).toBe(90)
    }
    expect(shot(0, PULL).zoom).toBeCloseTo(1.08)
    expect(shot(3000, PULL).zoom).toBeCloseTo(1)
    expect(shot(0, PUSH).zoom).toBeCloseTo(1)
    expect(shot(3000, PUSH).zoom).toBeCloseTo(1.08)
    // The push closes in on its focal point: right of and above center here.
    expect(shot(3000, PUSH).centerX).toBeGreaterThan(160)
    expect(shot(3000, PUSH).centerY).toBeLessThan(90)
    let previous = Infinity
    for (let t = 0; t <= 3000; t += 100) {
      const zoom = shot(t, PULL).zoom
      expect(zoom).toBeLessThanOrEqual(previous + 1e-12)
      previous = zoom
    }
  })

  test("pacing changes how far the move has gone at the midpoint", () => {
    const at = (ease: CinemaMove["ease"]) => shot(1000, { ...PUSH, ease }).zoom
    expect(at("out")).toBeGreaterThan(at("linear"))
    expect(at("linear")).toBeGreaterThan(at("in"))
  })

  test("drifts travel sideways in opposite directions at a fixed zoom", () => {
    const drift = (kind: "drift-left" | "drift-right"): CinemaMove => ({ ...PUSH, kind, zoom: 1.05, focusY: 0 })
    expect(shot(0, drift("drift-right")).zoom).toBe(1.05)
    expect(shot(3000, drift("drift-right")).zoom).toBe(1.05)
    expect(shot(3000, drift("drift-right")).centerX).toBeGreaterThan(shot(0, drift("drift-right")).centerX)
    expect(shot(3000, drift("drift-left")).centerX).toBeLessThan(shot(0, drift("drift-left")).centerX)
    expect(shot(1500, drift("drift-left")).centerY).toBe(90)
  })

  test("keeps the camera window inside the painted frame for any drawn move", () => {
    const random = seeded(11)
    const extremes: CinemaMove[] = [
      { kind: "push-in", zoom: CINEMA_ZOOM_MAX, ease: "out", focusX: 1, focusY: -1 },
      { kind: "pull-back", zoom: CINEMA_ZOOM_MAX, ease: "in", focusX: -1, focusY: 1 },
      { kind: "drift-left", zoom: CINEMA_ZOOM_MAX, ease: "linear", focusX: 0, focusY: 1 },
      { kind: "drift-right", zoom: 3, ease: "in-out", focusX: 5, focusY: -5 },
    ]
    for (const move of [...extremes, ...Array.from({ length: 200 }, () => chooseCinemaMove(random))])
      for (let t = 0; t <= 3000; t += 150) {
        const s = cinemaShot({ width: 320, height: 180, elapsedMs: t, durationMs: 3000, move })
        const halfW = 320 / s.zoom / 2
        const halfH = 180 / s.zoom / 2
        expect(s.zoom).toBeLessThanOrEqual(CINEMA_ZOOM_MAX)
        expect(s.centerX - halfW).toBeGreaterThanOrEqual(-1e-9)
        expect(s.centerX + halfW).toBeLessThanOrEqual(320 + 1e-9)
        expect(s.centerY - halfH).toBeGreaterThanOrEqual(-1e-9)
        expect(s.centerY + halfH).toBeLessThanOrEqual(180 + 1e-9)
      }
  })

  test("holds the camera still when the duration is unknown", () => {
    const still = (elapsedMs: number) => cinemaShot({ width: 320, height: 180, elapsedMs, move: PUSH })
    const a = still(200)
    const b = still(2000)
    expect(a.zoom).toBe(b.zoom)
    expect(b.exposure).toBe(1)
  })
})

describe("cinema finishing pass", () => {
  test("is deterministic, keeps the size, and never mutates the source", () => {
    const src = solid(64, 36, [90, 120, 160])
    const copy = Buffer.from(src)
    const s = cinemaShot({ width: 64, height: 36, elapsedMs: 1200, durationMs: 3000, move: PUSH })
    const a = applyCinema(src, 64, 36, s)
    expect(a).toHaveLength(64 * 36 * 3)
    expect(applyCinema(src, 64, 36, s).equals(a)).toBe(true)
    expect(src.equals(copy)).toBe(true)
  })

  test("returns black at zero exposure and for degenerate sizes", () => {
    const src = solid(16, 16, [200, 200, 200])
    const dark = applyCinema(src, 16, 16, { zoom: 1, centerX: 8, centerY: 8, exposure: 0 })
    expect(dark.every((v) => v === 0)).toBe(true)
    expect(applyCinema(src, 0, 16, { zoom: 1, centerX: 0, centerY: 8, exposure: 1 })).toHaveLength(0)
    expect(applyCinema(Buffer.alloc(3), 16, 16, { zoom: 1, centerX: 8, centerY: 8, exposure: 1 })).toHaveLength(
      16 * 16 * 3,
    )
  })

  test("keeps mid-tones close in the center and darkens the corners", () => {
    const w = 160
    const h = 90
    const src = solid(w, h, [100, 110, 120])
    const out = applyCinema(src, w, h, { zoom: 1, centerX: w / 2, centerY: h / 2, exposure: 1 })
    const center = pixel(out, w, w / 2, h / 2)
    for (let c = 0; c < 3; c++) expect(Math.abs(center[c]! - [100, 110, 120][c]!)).toBeLessThan(16)
    const corner = pixel(out, w, 0, 0)
    expect(corner[0]! + corner[1]! + corner[2]!).toBeLessThan(center[0]! + center[1]! + center[2]!)
  })

  test("blooms a bright light on a dark frame but not a bright sky", () => {
    const w = 160
    const h = 90
    const night = solid(w, h, [10, 14, 40])
    for (let y = 40; y < 50; y++)
      for (let x = 75; x < 85; x++) {
        const i = (y * w + x) * 3
        night[i] = 255
        night[i + 1] = 230
        night[i + 2] = 150
      }
    const lit = applyCinema(night, w, h, { zoom: 1, centerX: w / 2, centerY: h / 2, exposure: 1 })
    const plain = applyCinema(solid(w, h, [10, 14, 40]), w, h, { zoom: 1, centerX: w / 2, centerY: h / 2, exposure: 1 })
    // A few pixels outside the light pick up its glow.
    expect(pixel(lit, w, 70, 45)[0]!).toBeGreaterThan(pixel(plain, w, 70, 45)[0]! + 4)

    const sky = solid(w, h, [150, 200, 235])
    const graded = applyCinema(sky, w, h, { zoom: 1, centerX: w / 2, centerY: h / 2, exposure: 1 })
    const center = pixel(graded, w, w / 2, h / 2)
    expect(center[0]!).toBeLessThan(200)
  })

  test("zooming in magnifies the frame around the window center", () => {
    const w = 100
    const h = 60
    const src = Buffer.alloc(w * h * 3)
    // Left half dark, right half bright.
    for (let y = 0; y < h; y++) for (let x = 50; x < w; x++) src.fill(200, (y * w + x) * 3, (y * w + x) * 3 + 3)
    const wide = applyCinema(src, w, h, { zoom: 1, centerX: 50, centerY: 30, exposure: 1 })
    const close = applyCinema(src, w, h, { zoom: 2, centerX: 50, centerY: 30, exposure: 1 })
    // The edge stays at the center; a pixel 20 columns left of it was dark in both, but
    // 20 columns right is bright in both. At 2x the column 40 maps to source column 45.
    expect(pixel(wide, w, 40, 30)[0]!).toBeLessThan(30)
    expect(pixel(close, w, 40, 30)[0]!).toBeLessThan(30)
    expect(pixel(close, w, 60, 30)[0]!).toBeGreaterThan(120)
  })
})

describe("scene raster budget", () => {
  test("caps the starting raster at the pixel budget", () => {
    expect(sceneQualityCeiling(640, 360)).toBe(1)
    const ceiling = sceneQualityCeiling(1920, 1080)
    const size = sceneRasterSize(1920, 1080, ceiling)
    expect(size.width * size.height).toBeLessThanOrEqual(SCENE_PIXEL_BUDGET)
    expect(size.width % 2).toBe(0)
    expect(size.height % 2).toBe(0)
  })

  test("starts a 1920x1080 window at the 1600x900 raster ceiling", () => {
    // Benchmarked compromise: a 1920x1080 starting raster measured well over
    // the 30ms frame budget on every scene, so the ceiling stays at 1600x900
    // and the adaptive quality steering handles slower machines from there.
    expect(SCENE_PIXEL_BUDGET).toBe(1600 * 900)
    expect(sceneRasterSize(1920, 1080, sceneQualityCeiling(1920, 1080))).toEqual({ width: 1600, height: 900 })
    // Smaller windows keep their native size; the budget never upscales.
    expect(sceneRasterSize(1280, 720, sceneQualityCeiling(1280, 720))).toEqual({ width: 1280, height: 720 })
  })

  test("shrinks slow frames, grows fast ones, and stays inside its limits", () => {
    const slow = nextSceneQuality({ quality: 1, ceiling: 1, costMs: SCENE_FRAME_BUDGET_MS * 4 })
    expect(slow).toBeLessThan(1)
    expect(slow).toBeGreaterThanOrEqual(SCENE_MIN_QUALITY)
    expect(nextSceneQuality({ quality: 0.41, ceiling: 1, costMs: 10_000 })).toBe(SCENE_MIN_QUALITY)
    const fast = nextSceneQuality({ quality: 0.5, ceiling: 1, costMs: 1 })
    expect(fast).toBeGreaterThan(0.5)
    expect(nextSceneQuality({ quality: 0.8, ceiling: 0.8, costMs: 1 })).toBe(0.8)
    expect(nextSceneQuality({ quality: 0.7, ceiling: 1, costMs: SCENE_FRAME_BUDGET_MS })).toBe(0.7)
  })

  test("the player sends smaller scene rasters when frames run over budget", () => {
    const writes: string[] = []
    let clock = 0
    const player = digitalCodePixelPlayer((data) => writes.push(data), {
      // Each frame appears to cost 200ms on this clock.
      now: () => (clock += 100),
      move: PUSH,
    })
    const input = { width: 640, height: 360, columns: 80, rows: 24, direction: "down" as const }
    const sizes: number[] = []
    for (let i = 0; i < 4; i++) {
      player.draw({ ...input, style: "castle-day", elapsedMs: 1000 + i * 50, durationMs: 3000 })
      const header = /a=T,f=24,o=z,s=(\d+),v=(\d+),/.exec(writes.at(-1)!)!
      sizes.push(Number(header[1]))
      // The placement always covers the same cells.
      expect(writes.at(-1)).toContain("c=80,r=24,")
    }
    expect(sizes[0]).toBe(640)
    expect(sizes.at(-1)!).toBeLessThan(640)
    expect(sizes.at(-1)!).toBeGreaterThanOrEqual(640 * SCENE_MIN_QUALITY - 2)
    player.dispose()
  })

  test("scene frames carry the finished image and fade in from black", () => {
    const writes: string[] = []
    const player = digitalCodePixelPlayer((data) => writes.push(data), { now: () => 0, move: CINEMA_STILL })
    const decode = (data: string) =>
      inflateSync(
        Buffer.from([...data.matchAll(/\x1b_G[^;]*;([A-Za-z0-9+/=]*)\x1b\\/g)].map((m) => m[1]).join(""), "base64"),
      )
    const input = {
      width: 320,
      height: 180,
      columns: 80,
      rows: 24,
      direction: "down" as const,
      style: "castle-day" as const,
    }
    player.draw({ ...input, elapsedMs: 0, durationMs: 3000 })
    expect(decode(writes[0]!).every((v) => v === 0)).toBe(true)
    player.draw({ ...input, elapsedMs: 1500, durationMs: 3000 })
    const mid = decode(writes[1]!)
    expect(mid).toHaveLength(320 * 180 * 3)
    expect(mid.some((v) => v > 60)).toBe(true)
    player.dispose()
  })
})
