// Shared byte-level color helpers for the post-processing filters/effects.

export function toU8(value: number): number {
  return Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 255)
}

export function channel(buffer: Uint16Array, index: number): number {
  return (buffer[index] & 0xff) / 255
}

export function setRgb(buffer: Uint16Array, base: number, r: number, g: number, b: number): void {
  const a = buffer[base + 3] & 0xff
  buffer[base] = toU8(r)
  buffer[base + 1] = toU8(g)
  buffer[base + 2] = toU8(b)
  buffer[base + 3] = a
}
