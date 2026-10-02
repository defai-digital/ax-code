import type { HdCanvas, RGB } from "./scene-hd"

/**
 * Pixel-space painting helpers shared by the desert, forest, river, reef, and
 * table scenes. Everything here takes pixel coordinates and is deterministic.
 */

/** Cheap integer hash in [0, 1). */
export function artHash(a: number, b = 0): number {
  let n = (Math.imul(Math.floor(a) | 0, 374761393) + Math.imul(Math.floor(b) | 0, 668265263)) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

export function blendPixel(hd: HdCanvas, x: number, y: number, color: RGB, alpha: number) {
  if (x < 0 || y < 0 || x >= hd.w || y >= hd.h || alpha <= 0) return
  const a = Math.min(1, alpha)
  const i = (y * hd.w + x) * 3
  hd.pixels[i] = Math.round(hd.pixels[i]! + (color[0] - hd.pixels[i]!) * a)
  hd.pixels[i + 1] = Math.round(hd.pixels[i + 1]! + (color[1] - hd.pixels[i + 1]!) * a)
  hd.pixels[i + 2] = Math.round(hd.pixels[i + 2]! + (color[2] - hd.pixels[i + 2]!) * a)
}

/** Additive radial glow with quadratic falloff out to `radius`. */
export function glow(hd: HdCanvas, cx: number, cy: number, radius: number, color: RGB, strength: number) {
  if (radius <= 0 || strength <= 0) return
  const xa = Math.max(0, Math.floor(cx - radius))
  const xb = Math.min(hd.w - 1, Math.ceil(cx + radius))
  const ya = Math.max(0, Math.floor(cy - radius))
  const yb = Math.min(hd.h - 1, Math.ceil(cy + radius))
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius
      if (d >= 1) continue
      blendPixel(hd, x, y, color, strength * (1 - d) * (1 - d))
    }
  }
}

/** Disk with a one-pixel soft edge. */
export function softDisk(hd: HdCanvas, cx: number, cy: number, r: number, color: RGB, alpha = 1) {
  if (r <= 0) return
  const xa = Math.max(0, Math.floor(cx - r - 1))
  const xb = Math.min(hd.w - 1, Math.ceil(cx + r + 1))
  const ya = Math.max(0, Math.floor(cy - r - 1))
  const yb = Math.min(hd.h - 1, Math.ceil(cy + r + 1))
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const cover = Math.max(0, Math.min(1, r - d + 0.5))
      if (cover > 0) blendPixel(hd, x, y, color, cover * alpha)
    }
  }
}

/** Thick line with soft ends, in pixel space. Radius may differ per end. */
export function artLine(
  hd: HdCanvas,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r0: number,
  r1: number,
  color: RGB,
  alpha = 1,
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(0.5, Math.min(r0, r1) * 0.6)))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    softDisk(hd, ax + (bx - ax) * t, ay + (by - ay) * t, r0 + (r1 - r0) * t, color, alpha)
  }
}

/**
 * Fill a convex or concave polygon by scanline. `shade` picks the color per
 * pixel; returning null skips the pixel.
 */
export function polyFill(
  hd: HdCanvas,
  points: readonly (readonly [number, number])[],
  shade: (x: number, y: number) => RGB | null,
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
    const xs: number[] = []
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      const q = points[(i + 1) % points.length]!
      if ((p[1] <= sy && q[1] > sy) || (q[1] <= sy && p[1] > sy)) {
        xs.push(p[0] + ((sy - p[1]) / (q[1] - p[1])) * (q[0] - p[0]))
      }
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k]!))
      const xb = Math.min(hd.w, Math.round(xs[k + 1]!))
      for (let x = xa; x < xb; x++) {
        const color = shade(x, y)
        if (color) hd.set(x, y, color)
      }
    }
  }
}

/** Darken pixel corners toward the edges of the frame. */
export function vignette(hd: HdCanvas, strength: number) {
  if (hd.w === 0 || hd.h === 0) return
  for (let y = 0; y < hd.h; y++) {
    const dy = (y + 0.5) / hd.h - 0.5
    for (let x = 0; x < hd.w; x++) {
      const dx = (x + 0.5) / hd.w - 0.5
      const k = 1 - strength * Math.min(1, (dx * dx + dy * dy) * 2.2)
      const i = (y * hd.w + x) * 3
      hd.pixels[i] = Math.round(hd.pixels[i]! * k)
      hd.pixels[i + 1] = Math.round(hd.pixels[i + 1]! * k)
      hd.pixels[i + 2] = Math.round(hd.pixels[i + 2]! * k)
    }
  }
}
