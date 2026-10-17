import { artHash, blendPixel, polyFill } from "./scene-art-kit"
import type { HdCanvas, RGB } from "./scene-hd"

/** Soft-edged ellipsoid with a directional key and cool rim, in scene coordinates. */
export function paintVolume(hd: HdCanvas, x: number, y: number, rx: number, ry: number, color: RGB, night: boolean) {
  const cx = hd.X(x),
    cy = hd.Y(y),
    a = hd.cw * rx,
    b = hd.ch * ry
  if (a <= 0 || b <= 0) return
  const edge = Math.max(1, Math.min(a, b))
  for (let py = Math.max(0, Math.floor(cy - b - 1)); py < Math.min(hd.h, Math.ceil(cy + b + 1)); py++) {
    const ny = (py + 0.5 - cy) / b
    for (let px = Math.max(0, Math.floor(cx - a - 1)); px < Math.min(hd.w, Math.ceil(cx + a + 1)); px++) {
      const nx = (px + 0.5 - cx) / a
      const r2 = nx * nx + ny * ny
      if (r2 > 1 + 1 / edge) continue
      const nz = Math.sqrt(Math.max(0, 1 - r2))
      const key = Math.max(0, -nx * 0.4 - ny * 0.65 + nz * 0.64)
      const rim = Math.pow(Math.max(0, 1 - nz), 3) * Math.max(0, -ny) * (night ? 0.8 : 0.24)
      const grain = 0.985 + artHash(px >> 1, py >> 1) * 0.03
      const gain = (0.42 + key * 0.65) * grain
      const tone: RGB = [
        Math.min(255, color[0] * gain + rim * 112),
        Math.min(255, color[1] * gain + rim * 150),
        Math.min(255, color[2] * gain + rim * 179),
      ]
      blendPixel(hd, px, py, tone, Math.min(1, Math.max(0, (1 - Math.sqrt(r2)) * edge + 0.5)))
    }
  }
}

/** Closed Catmull-Rom contour. Curves join anatomy without overlapping round caps. */
export function paintContour(
  hd: HdCanvas,
  anchors: readonly (readonly [number, number])[],
  shade: (x: number, y: number) => RGB,
) {
  const points: (readonly [number, number])[] = []
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[(i + anchors.length - 1) % anchors.length]!
    const b = anchors[i]!
    const c = anchors[(i + 1) % anchors.length]!
    const d = anchors[(i + 2) % anchors.length]!
    for (let step = 0; step < 8; step++) {
      const t = step / 8,
        t2 = t * t,
        t3 = t2 * t
      const at = (k: 0 | 1) =>
        0.5 *
        (2 * b[k] +
          (-a[k] + c[k]) * t +
          (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 +
          (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3)
      points.push([hd.X(at(0)), hd.Y(at(1))])
    }
  }
  polyFill(hd, points, shade)
}
