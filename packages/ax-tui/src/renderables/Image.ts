import { Renderable, type RenderableOptions } from "../core/renderable.js"
import type { OptimizedBuffer } from "../core/buffer.js"
import type { RenderContext } from "../core/types.js"
import { copyRgbaImage, decodePng, MAX_PNG_BYTES, type RgbaImage } from "../lib/image.js"
import { encodeKittyImage, KittyImageSession, kittyPlaceholder, MAX_KITTY_CELLS,
  supportsKittyPlaceholders, type ImageProtocol } from "../lib/kitty-image.js"
import { RGBA, parseColor, type ColorInput } from "../lib/rgba.js"
import { stripAnsiSequences } from "../lib/paste.js"

export type ImageSource = RgbaImage | Uint8Array | ((signal: AbortSignal) => Promise<RgbaImage | Uint8Array>)
export type ImageFit = "contain" | "cover" | "fill"

export interface ImageOptions extends RenderableOptions<ImageRenderable> {
  source?: ImageSource
  alt?: string
  fit?: ImageFit
  protocol?: ImageProtocol
  /** Terminal cell height divided by width; defaults to 2. */
  cellAspectRatio?: number
  backgroundColor?: ColorInput
  onLoad?: () => void
  onError?: (error: unknown) => void
}

interface KittyPlacement {
  id: number
  width: number
  height: number
  epoch: number
  bytes: Uint8Array | null
}

// Alt text is drawn into a cell buffer when no image is available; unbounded
// input would flood the buffer and the terminal.
const MAX_ALT_LENGTH = 1024

export class ImageRenderable extends Renderable {
  private _source?: ImageSource
  private pixels: RgbaImage | null = null
  private controller?: AbortController
  private loadGeneration = 0
  private placement: KittyPlacement | null = null
  private _alt: string
  private _fit: ImageFit
  private _protocol: ImageProtocol
  private _cellAspectRatio: number
  private _backgroundColor: RGBA
  private readonly kittySession: KittyImageSession
  public onLoad?: () => void
  public onError?: (error: unknown) => void
  public loadPromise: Promise<void> = Promise.resolve()
  public loadError: unknown = null

  constructor(context: RenderContext, options: ImageOptions = {}) {
    const fit = options.fit ?? "contain", protocol = options.protocol ?? "auto"
    const aspect = options.cellAspectRatio ?? 2
    if (!["contain", "cover", "fill"].includes(fit) || !["auto", "kitty", "blocks"].includes(protocol) ||
      !Number.isFinite(aspect) || aspect <= 0 || aspect > 100) throw new RangeError("Invalid image display options")
    super(context, { width: 40, height: 12, ...options, buffered: true })
    this._alt = this.cleanAlt(options.alt ?? "Image unavailable")
    this._fit = fit
    this._protocol = protocol
    this._cellAspectRatio = aspect
    this._backgroundColor = RGBA.clone(parseColor(options.backgroundColor ?? "black"))
    this.onLoad = options.onLoad
    this.onError = options.onError
    this.kittySession = KittyImageSession.forContext(context)
    if (options.source !== undefined) this.source = options.source
  }

  private cleanAlt(text: string): string {
    const cleaned = stripAnsiSequences(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    if (cleaned.length <= MAX_ALT_LENGTH) return cleaned
    // Do not split a surrogate pair at the truncation boundary.
    let end = MAX_ALT_LENGTH
    const code = cleaned.charCodeAt(end - 1)
    if (code >= 0xd800 && code <= 0xdbff) end--
    return cleaned.slice(0, end)
  }

  get source(): ImageSource | undefined { return this._source }
  set source(source: ImageSource | undefined) {
    if (this.isDestroyed) return
    const generation = ++this.loadGeneration
    const previous = this.controller
    this.controller = undefined
    previous?.abort()
    // Abort listeners can synchronously replace this source or destroy the image.
    if (this.isDestroyed || this.loadGeneration !== generation) return
    this._source = source
    this.pixels = null
    this.loadError = null
    this.retirePlacement()
    this.requestRender()
    if (source === undefined) {
      this.loadPromise = Promise.resolve()
      return
    }
    const controller = new AbortController()
    this.controller = controller
    // Snapshot direct inputs before deferring work; loaders own their asynchronous I/O.
    let snapshot: RgbaImage | Uint8Array | undefined
    let snapshotError: unknown
    try {
      if (source instanceof Uint8Array && source.length > MAX_PNG_BYTES) {
        throw new RangeError("PNG exceeds the 16 MiB encoded byte budget")
      }
      snapshot = typeof source === "function" ? undefined : source instanceof Uint8Array ?
        new Uint8Array(source) : copyRgbaImage(source)
    } catch (error) { snapshotError = error }
    this.loadPromise = (async () => {
      await Promise.resolve()
      try {
        if (controller.signal.aborted || this.isDestroyed || this.controller !== controller) return
        if (snapshotError) throw snapshotError
        const value = typeof source === "function" ? await source(controller.signal) : snapshot!
        if (controller.signal.aborted || this.isDestroyed || this.controller !== controller) return
        this.pixels = value instanceof Uint8Array ? decodePng(value) : copyRgbaImage(value)
        this.requestRender()
        this.onLoad?.()
      } catch (error) {
        if (controller.signal.aborted || this.isDestroyed || this.controller !== controller) return
        this.pixels = null
        this.loadError = error
        this.requestRender()
        this.onError?.(error)
        throw error
      } finally {
        if (this.controller === controller) this.controller = undefined
      }
    })()
    // Keep rejection observable to awaiters without crashing applications that use onError/loadError.
    void this.loadPromise.catch(() => {})
  }

  get alt(): string { return this._alt }
  set alt(value: string) {
    if (!this.isDestroyed) {
      this._alt = this.cleanAlt(value)
      this.requestRender()
    }
  }
  get fit(): ImageFit { return this._fit }
  set fit(value: ImageFit) {
    if (!["contain", "cover", "fill"].includes(value)) throw new RangeError("Invalid image fit")
    if (!this.isDestroyed && value !== this._fit) {
      this._fit = value
      this.retirePlacement()
      this.requestRender()
    }
  }
  get protocol(): ImageProtocol { return this._protocol }
  set protocol(value: ImageProtocol) {
    if (!["auto", "kitty", "blocks"].includes(value)) throw new RangeError("Invalid image protocol")
    if (!this.isDestroyed && value !== this._protocol) {
      this._protocol = value
      this.retirePlacement()
      this.requestRender()
    }
  }
  get cellAspectRatio(): number { return this._cellAspectRatio }
  set cellAspectRatio(value: number) {
    if (!Number.isFinite(value) || value <= 0 || value > 100) throw new RangeError("Invalid image cell aspect ratio")
    if (!this.isDestroyed) {
      this._cellAspectRatio = value
      this.retirePlacement()
      this.requestRender()
    }
  }
  get backgroundColor(): RGBA { return RGBA.clone(this._backgroundColor) }
  set backgroundColor(value: ColorInput) {
    if (!this.isDestroyed) {
      this._backgroundColor = RGBA.clone(parseColor(value))
      this.requestRender()
    }
  }

  get effectiveProtocol(): "kitty" | "blocks" {
    if (this._protocol === "blocks" || this._fit !== "contain" || !this._ctx.queueTerminalControl ||
      this._ctx.allowKittyImages === false || this.width > MAX_KITTY_CELLS || this.height > MAX_KITTY_CELLS ||
      !supportsKittyPlaceholders(this._ctx.capabilities, this._protocol === "kitty")) return "blocks"
    for (let node: Renderable | null = this; node; node = node.parent instanceof Renderable ? node.parent : null) {
      if (node.opacity !== 1) return "blocks"
    }
    return "kitty"
  }

  private retirePlacement(): void {
    if (!this.placement) return
    this.kittySession.retire(this.placement.id)
    this.placement = null
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    buffer.clear(this._backgroundColor)
    const image = this.pixels
    if (!image) {
      buffer.drawText(this._alt, 0, 0, RGBA.fromInts(180, 180, 180), this._backgroundColor)
      return
    }
    const scale = this._fit === "fill" ? 0 : (this._fit === "contain" ? Math.min : Math.max)(
      this.width / image.width, this.height * this._cellAspectRatio / image.height)
    const width = this._fit === "fill" ? this.width : Math.max(1, Math.round(image.width * scale))
    const height = this._fit === "fill" ? this.height : Math.max(1,
      Math.round(image.height * scale / this._cellAspectRatio))
    const left = Math.floor((this.width - width) / 2), top = Math.floor((this.height - height) / 2)
    if (this.effectiveProtocol === "kitty" && width <= MAX_KITTY_CELLS && height <= MAX_KITTY_CELLS) {
      const epoch = this._ctx.terminalControlEpoch ?? 0
      if (this.placement && (this.placement.width !== width || this.placement.height !== height ||
        this.placement.epoch !== epoch)) this.retirePlacement()
      if (!this.placement) {
        const id = this.kittySession.allocate()
        if (id !== null) this.placement = { id, width, height, epoch, bytes: encodeKittyImage(image, id, width, height) }
      }
      const placement = this.placement
      if (placement && (!placement.bytes || this._ctx.queueTerminalControl!(placement.bytes))) {
        placement.bytes = null
        const color = RGBA.fromInts((placement.id >>> 16) & 255, (placement.id >>> 8) & 255, placement.id & 255)
        for (let y = 0; y < height; y++) {
          let row = ""
          for (let x = 0; x < width; x++) row += kittyPlaceholder(placement.id, y, x)
          buffer.drawText(row, left, top + y, color, this._backgroundColor)
        }
        return
      }
      if (placement) this.requestRender()
    } else {
      this.retirePlacement()
    }
    const background = this._backgroundColor.toInts()
    const sample = (x: number, y: number) => {
      const sx = Math.min(image.width - 1, Math.max(0, Math.floor(x * image.width / width)))
      const sy = Math.min(image.height - 1, Math.max(0, Math.floor(y * image.height / (height * 2))))
      const offset = (sy * image.width + sx) * 4
      const alpha = image.data[offset + 3]! / 255
      // Each half is a distinct pixel. Flatten it independently before the cell
      // compositor can blend a translucent foreground over the lower half.
      return RGBA.fromInts(
        image.data[offset]! * alpha + background[0] * (1 - alpha),
        image.data[offset + 1]! * alpha + background[1] * (1 - alpha),
        image.data[offset + 2]! * alpha + background[2] * (1 - alpha),
      )
    }
    for (let y = Math.max(0, top); y < Math.min(this.height, top + height); y++) {
      for (let x = Math.max(0, left); x < Math.min(this.width, left + width); x++) {
        const upper = sample(x - left, (y - top) * 2), lower = sample(x - left, (y - top) * 2 + 1)
        buffer.setCell(x, y, "▀", upper, lower)
      }
    }
  }

  protected destroySelf(): void {
    this.loadGeneration++
    const controller = this.controller
    this.controller = undefined
    controller?.abort()
    this.retirePlacement()
    this.pixels = null
    this._source = undefined
    super.destroySelf()
  }
}
