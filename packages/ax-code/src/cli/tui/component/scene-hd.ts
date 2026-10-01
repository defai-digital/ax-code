/** Shared freeform painters for the landmark and landscape openings.
 * Fuji paints smooth shapes instead of scaling ASCII cells. These helpers
 * give the other scenes the same sky, halo, shaded mass, water, and canopy. */

export type RGB = readonly [number, number, number]

export function hdHex(value: string): RGB {
  return [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number]
}

export function hdMix(a: RGB, b: RGB, t: number): RGB {
  const u = Math.max(0, Math.min(1, t))
  return [0, 1, 2].map((channel) => Math.round(a[channel]! + (b[channel]! - a[channel]!) * u)) as [
    number,
    number,
    number,
  ]
}

export function hdDarken(color: RGB, factor: number): RGB {
  return [0, 1, 2].map((channel) => Math.max(0, Math.min(255, Math.round(color[channel]! * factor)))) as [
    number,
    number,
    number,
  ]
}

export type HdCanvas = {
  pixels: Buffer
  w: number
  h: number
  cw: number
  ch: number
  X: (sceneX: number) => number
  Y: (sceneY: number) => number
  set: (x: number, y: number, color: RGB) => void
  rect: (x0: number, y0: number, x1: number, y1: number, color: RGB) => void
  disk: (cx: number, cy: number, r: number, color: RGB) => void
  /** Axis-aligned ellipse. `speck` dots the fill the way Fuji dots sakura. */
  blob: (cx: number, cy: number, rx: number, ry: number, fill: RGB, speck?: RGB) => void
  sky: (sample: (t: number) => RGB) => void
  /** Three-layer sun or moon. `coreR` is the bright disk in pixels. */
  halo: (cx: number, cy: number, coreR: number, core: RGB, body: RGB, sky: RGB) => void
  /** Stacked disks, wider than a single ASCII cloud cell. */
  puff: (sceneX: number, sceneY: number, sceneW: number, color: RGB) => void
  /** Tapered lit/shade mass. `t` runs 0 at the apex to 1 at the base. */
  mass: (
    apexSceneX: number,
    y0Scene: number,
    y1Scene: number,
    halfTop: number,
    halfBottom: number,
    lit: RGB,
    shade: RGB,
    edge: RGB,
  ) => void
  /** Vertical water gradient plus a looping ripple. `phase` is radians. */
  water: (y0Scene: number, y1Scene: number, top: RGB, deep: RGB, phase: number) => void
  /** Shimmering column under a sun or moon. */
  reflection: (
    centerSceneX: number,
    y0Scene: number,
    y1Scene: number,
    color: RGB,
    phase: number,
    widthScene?: number,
  ) => void
  stars: (points: readonly { x: number; y: number }[], color: RGB, bright: (index: number) => boolean) => void
  /** Thick scene-space segment, used for beams, legs, and bridges. */
  stroke: (x0: number, y0: number, x1: number, y1: number, radius: number, color: RGB) => void
}

export function createHdCanvas(width: number, height: number, columns: number, rows: number): HdCanvas {
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  const pixels = Buffer.alloc(w * h * 3)
  const cw = columns > 0 ? w / columns : 0
  const ch = rows > 0 ? h / rows : 0
  const X = (sceneX: number) => sceneX * cw
  const Y = (sceneY: number) => sceneY * ch
  const empty = w === 0 || h === 0

  const set = (x: number, y: number, color: RGB) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 3
    pixels[i] = color[0]!
    pixels[i + 1] = color[1]!
    pixels[i + 2] = color[2]!
  }
  const rect = (x0: number, y0: number, x1: number, y1: number, color: RGB) => {
    if (empty) return
    const xa = Math.max(0, Math.floor(Math.min(x0, x1)))
    const xb = Math.min(w, Math.ceil(Math.max(x0, x1)))
    const ya = Math.max(0, Math.floor(Math.min(y0, y1)))
    const yb = Math.min(h, Math.ceil(Math.max(y0, y1)))
    for (let y = ya; y < yb; y++) {
      let i = (y * w + xa) * 3
      for (let x = xa; x < xb; x++) {
        pixels[i++] = color[0]!
        pixels[i++] = color[1]!
        pixels[i++] = color[2]!
      }
    }
  }
  const disk = (cx: number, cy: number, r: number, color: RGB) => {
    if (empty || r <= 0) return
    const xa = Math.max(0, Math.floor(cx - r))
    const xb = Math.min(w - 1, Math.ceil(cx + r))
    const ya = Math.max(0, Math.floor(cy - r))
    const yb = Math.min(h - 1, Math.ceil(cy + r))
    const r2 = r * r
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        if (dx * dx + dy * dy <= r2) set(x, y, color)
      }
    }
  }
  const blob = (cx: number, cy: number, rx: number, ry: number, fill: RGB, speck?: RGB) => {
    if (empty || rx <= 0 || ry <= 0) return
    const xa = Math.max(0, Math.floor(cx - rx))
    const xb = Math.min(w - 1, Math.ceil(cx + rx))
    const ya = Math.max(0, Math.floor(cy - ry))
    const yb = Math.min(h - 1, Math.ceil(cy + ry))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = (x + 0.5 - cx) / rx
        const dy = (y + 0.5 - cy) / ry
        if (dx * dx + dy * dy > 1) continue
        set(x, y, speck && (x * 37 + y * 91) % 7 === 0 ? speck : fill)
      }
    }
  }
  const sky = (sample: (t: number) => RGB) => {
    if (empty) return
    for (let y = 0; y < h; y++) {
      const [r, g, b] = sample(h <= 1 ? 0 : y / (h - 1))
      let i = y * w * 3
      for (let x = 0; x < w; x++) {
        pixels[i++] = r
        pixels[i++] = g
        pixels[i++] = b
      }
    }
  }
  const halo = (cx: number, cy: number, coreR: number, core: RGB, body: RGB, around: RGB) => {
    const r = Math.max(2, coreR)
    disk(cx, cy, r * 2.6, hdMix(body, around, 0.78))
    disk(cx, cy, r * 1.65, hdMix(body, around, 0.4))
    disk(cx, cy, r, core)
  }
  const puff = (sceneX: number, sceneY: number, sceneW: number, color: RGB) => {
    const cy = Y(sceneY)
    const span = Math.max(1, Math.floor(sceneW))
    for (let i = 0; i < span; i++) {
      disk(X(sceneX + i), cy, ch * 0.55, color)
      if (i % 2 === 0) disk(X(sceneX + i), cy - ch * 0.4, ch * 0.38, color)
    }
  }
  const mass = (
    apexSceneX: number,
    y0Scene: number,
    y1Scene: number,
    halfTop: number,
    halfBottom: number,
    lit: RGB,
    shade: RGB,
    edge: RGB,
  ) => {
    if (empty) return
    const peakX = X(apexSceneX)
    const topY = Y(y0Scene)
    const baseY = Y(y1Scene)
    const rowTop = Math.max(0, Math.floor(Math.min(topY, baseY)))
    const rowBottom = Math.min(h, Math.ceil(Math.max(topY, baseY)))
    for (let y = rowTop; y < rowBottom; y++) {
      const t = (y + 0.5 - topY) / (baseY - topY || 1)
      const halfW = (halfTop + Math.pow(Math.max(0, Math.min(1, t)), 1.5) * (halfBottom - halfTop)) * cw
      const xa = Math.max(0, Math.floor(peakX - halfW))
      const xb = Math.min(w, Math.ceil(peakX + halfW))
      const faceX = peakX + halfW * 0.18
      for (let x = xa; x < xb; x++) set(x, y, x < faceX ? lit : shade)
      set(xa, y, edge)
      if (xb - 1 > xa) set(xb - 1, y, edge)
    }
  }
  const water = (y0Scene: number, y1Scene: number, top: RGB, deep: RGB, phase: number) => {
    if (empty) return
    const y0 = Y(y0Scene)
    const y1 = Y(y1Scene)
    const ripple = new Float32Array(w)
    for (let x = 0; x < w; x++) ripple[x] = Math.sin((x / Math.max(1, w)) * Math.PI * 12 + phase) * 7
    const ya = Math.max(0, Math.floor(Math.min(y0, y1)))
    const yb = Math.min(h, Math.ceil(Math.max(y0, y1)))
    for (let y = ya; y < yb; y++) {
      const u = (y - y0) / (y1 - y0 || 1)
      for (let x = 0; x < w; x++) {
        const wave = ripple[x]!
        const i = (y * w + x) * 3
        pixels[i] = Math.max(0, Math.min(255, Math.round(top[0]! + (deep[0]! - top[0]!) * u + wave)))
        pixels[i + 1] = Math.max(0, Math.min(255, Math.round(top[1]! + (deep[1]! - top[1]!) * u + wave * 0.55)))
        pixels[i + 2] = Math.max(0, Math.min(255, Math.round(top[2]! + (deep[2]! - top[2]!) * u + wave * 0.35)))
      }
    }
  }
  const reflection = (
    centerSceneX: number,
    y0Scene: number,
    y1Scene: number,
    color: RGB,
    phase: number,
    widthScene = 4,
  ) => {
    if (empty) return
    const y0 = Y(y0Scene)
    const y1 = Y(y1Scene)
    const center = X(centerSceneX)
    const ya = Math.max(0, Math.floor(Math.min(y0, y1)))
    const yb = Math.min(h, Math.ceil(Math.max(y0, y1)))
    for (let y = ya; y < yb; y++) {
      const u = (y - y0) / (y1 - y0 || 1)
      const wave = Math.sin(y * 0.35 + phase) * cw * 0.6
      const half = X(widthScene / 2) * (0.55 + u * 0.7)
      const xa = Math.max(0, Math.floor(center - half + wave))
      const xb = Math.min(w, Math.ceil(center + half + wave))
      for (let x = xa; x < xb; x++) {
        if ((x + y) % 5 === 0) continue
        set(x, y, color)
      }
    }
  }
  const stars = (points: readonly { x: number; y: number }[], color: RGB, bright: (index: number) => boolean) => {
    const radius = Math.max(1, Math.round(Math.min(cw, ch) * 0.22))
    points.forEach((point, index) => {
      const cx = X(point.x + 0.5)
      const cy = Y(point.y + 0.5)
      if (bright(index)) disk(cx, cy, radius, color)
      else set(Math.floor(cx), Math.floor(cy), color)
    })
  }
  const stroke = (x0: number, y0: number, x1: number, y1: number, radius: number, color: RGB) => {
    if (empty || radius <= 0) return
    const ax = X(x0)
    const ay = Y(y0)
    const bx = X(x1)
    const by = Y(y1)
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      disk(ax + (bx - ax) * t, ay + (by - ay) * t, radius, color)
    }
  }

  return {
    pixels,
    w,
    h,
    cw,
    ch,
    X,
    Y,
    set,
    rect,
    disk,
    blob,
    sky,
    halo,
    puff,
    mass,
    water,
    reflection,
    stars,
    stroke,
  }
}
