import { hdMix, type HdCanvas, type RGB } from "./scene-hd"

/** Pixel-space painters shared by the HD scene renderers. Everything is deterministic. */

export function blendPx(hd: HdCanvas, x: number, y: number, color: RGB, alpha: number) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= hd.w || y >= hd.h) return
  const a = Math.min(1, alpha)
  const i = (y * hd.w + x) * 3
  hd.pixels[i] = Math.round(hd.pixels[i]! + (color[0] - hd.pixels[i]!) * a)
  hd.pixels[i + 1] = Math.round(hd.pixels[i + 1]! + (color[1] - hd.pixels[i + 1]!) * a)
  hd.pixels[i + 2] = Math.round(hd.pixels[i + 2]! + (color[2] - hd.pixels[i + 2]!) * a)
}

/** Soft radial bloom blended over whatever is already painted. */
export function glow(hd: HdCanvas, cx: number, cy: number, radius: number, color: RGB, strength: number, squash = 1) {
  if (hd.w === 0 || hd.h === 0 || radius <= 0 || strength <= 0) return
  const ry = radius * squash
  const xa = Math.max(0, Math.floor(cx - radius))
  const xb = Math.min(hd.w - 1, Math.ceil(cx + radius))
  const ya = Math.max(0, Math.floor(cy - ry))
  const yb = Math.min(hd.h - 1, Math.ceil(cy + ry))
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const d = Math.hypot((x + 0.5 - cx) / radius, (y + 0.5 - cy) / ry)
      if (d >= 1) continue
      const f = 1 - d
      blendPx(hd, x, y, color, strength * f * f)
    }
  }
}

/** Scanline fill of a convex polygon; `colorAt` receives pixel coordinates. */
export function fillPoly(
  hd: HdCanvas,
  points: readonly (readonly [number, number])[],
  colorAt: (x: number, y: number) => RGB,
) {
  if (hd.w === 0 || hd.h === 0 || points.length < 3) return
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    minY = Math.min(minY, p[1])
    maxY = Math.max(maxY, p[1])
  }
  const ya = Math.max(0, Math.floor(minY))
  const yb = Math.min(hd.h - 1, Math.ceil(maxY))
  for (let y = ya; y <= yb; y++) {
    const sy = y + 0.5
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
        const x = a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0])
        lo = Math.min(lo, x)
        hi = Math.max(hi, x)
      }
    }
    if (lo > hi) continue
    const xa = Math.max(0, Math.round(lo))
    const xb = Math.min(hd.w, Math.round(hi))
    for (let x = xa; x < xb; x++) hd.set(x, y, colorAt(x, y))
  }
}

/** Vertical gradient box. */
export function vrect(hd: HdCanvas, x0: number, y0: number, x1: number, y1: number, top: RGB, bottom: RGB) {
  const ya = Math.max(0, Math.floor(Math.min(y0, y1)))
  const yb = Math.min(hd.h, Math.ceil(Math.max(y0, y1)))
  for (let y = ya; y < yb; y++) hd.rect(x0, y, x1, y + 1, hdMix(top, bottom, (y + 0.5 - y0) / (y1 - y0 || 1)))
}

/** Horizontal gradient box, good for cylinders and lit/shaded faces. */
export function hrect(hd: HdCanvas, x0: number, y0: number, x1: number, y1: number, left: RGB, right: RGB) {
  const xa = Math.max(0, Math.floor(Math.min(x0, x1)))
  const xb = Math.min(hd.w, Math.ceil(Math.max(x0, x1)))
  for (let x = xa; x < xb; x++) hd.rect(x, y0, x + 1, y1, hdMix(left, right, (x + 0.5 - x0) / (x1 - x0 || 1)))
}

/** Deterministic 0..1 hash of an integer pair. */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Smooth value noise over the scene-local lattice hash (stable per-scene output; distinct from hash2). */
export function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
