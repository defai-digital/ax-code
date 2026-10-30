import { randomInt } from "node:crypto"
import { deflateSync } from "node:zlib"
import type { RenderContext, TerminalCapabilities } from "../core/types.js"
import { KITTY_DIACRITICS } from "./kitty-diacritics.js"
import type { RgbaImage } from "./image.js"

export type ImageProtocol = "auto" | "kitty" | "blocks"
export const KITTY_PLACEHOLDER = "\u{10eeee}"
export const MAX_KITTY_CELLS = KITTY_DIACRITICS.length
const sessions = new WeakMap<RenderContext, KittyImageSession>()
const allocatedIds = new Set<number>()
const encoder = new TextEncoder()

export function supportsKittyPlaceholders(capabilities: TerminalCapabilities | null, explicit = false): boolean {
  if (!capabilities?.kitty_graphics || !capabilities.rgb || capabilities.multiplexer !== "none") return false
  if (explicit) return true
  const version = /^(\d+)\.(\d+)/.exec(capabilities.terminal.version)
  return capabilities.terminal.name.toLowerCase() === "kitty" && !!version &&
    (Number(version[1]) > 0 || Number(version[2]) >= 28)
}

/** Explicit coordinates prevent incorrect inheritance after horizontal clipping or occlusion. */
export function kittyPlaceholder(id: number, row: number, column: number): string {
  if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || !Number.isInteger(row) || !Number.isInteger(column) ||
    row < 0 || column < 0 || row >= MAX_KITTY_CELLS || column >= MAX_KITTY_CELLS) {
    throw new RangeError("Invalid Kitty placeholder coordinates or image ID")
  }
  return KITTY_PLACEHOLDER + KITTY_DIACRITICS[row]! + KITTY_DIACRITICS[column]! + KITTY_DIACRITICS[id >>> 24]!
}

export function encodeKittyImage(image: RgbaImage, id: number, columns: number, rows: number): Uint8Array {
  kittyPlaceholder(id, rows - 1, columns - 1)
  const payload = deflateSync(image.data, { level: 3 }).toString("base64")
  const sequences: string[] = []
  for (let offset = 0; offset < payload.length; offset += 4096) {
    const more = offset + 4096 < payload.length ? 1 : 0
    const controls = offset === 0 ? `a=t,f=32,o=z,t=d,s=${image.width},v=${image.height},i=${id},q=2,m=${more}` :
      `m=${more}`
    sequences.push(`\x1b_G${controls};${payload.slice(offset, offset + 4096)}\x1b\\`)
  }
  sequences.push(`\x1b_Ga=p,U=1,i=${id},c=${columns},r=${rows},q=2\x1b\\`)
  return encoder.encode(sequences.join(""))
}

/** Per-renderer ownership of uploaded IDs and deferred targeted deletion. */
export class KittyImageSession {
  private ids = new Set<number>()
  private retired = new Set<number>()
  private disposed = false

  private constructor(private readonly context: RenderContext) {
    context.on("frame", this.flushRetired)
    context.on("capabilities", this.invalidate)
    context.once("destroy", this.dispose)
  }

  private invalidate = (): void => { this.context.requestRender() }

  static forContext(context: RenderContext): KittyImageSession {
    let session = sessions.get(context)
    if (!session) {
      session = new KittyImageSession(context)
      sessions.set(context, session)
    }
    return session
  }

  allocate(): number | null {
    if (this.disposed || this.ids.size >= 256) return null
    let id: number
    do { id = randomInt(1, 0x1_0000_0000) } while (allocatedIds.has(id))
    allocatedIds.add(id)
    this.ids.add(id)
    return id
  }

  retire(id: number): void {
    if (this.disposed || !this.ids.has(id)) return
    this.retired.add(id)
    this.context.requestRender()
  }

  private flushRetired = (): void => {
    for (const id of [...this.retired]) {
      if (!this.context.queueTerminalControl?.(encoder.encode(`\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`))) break
      this.retired.delete(id)
      this.ids.delete(id)
      allocatedIds.delete(id)
    }
  }

  private dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    for (const id of this.ids) {
      this.context.queueTerminalControl?.(encoder.encode(`\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`))
      allocatedIds.delete(id)
    }
    this.ids.clear()
    this.retired.clear()
    this.context.off("frame", this.flushRetired)
    this.context.off("capabilities", this.invalidate)
    this.context.off("destroy", this.dispose)
    sessions.delete(this.context)
  }
}
