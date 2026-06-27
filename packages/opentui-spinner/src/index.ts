import { Renderable, parseColor, resolveRenderLib } from "@ax-code/opentui-core"
import type { ColorInput, LayoutOptions, OptimizedBuffer, RenderContext, RenderableOptions } from "@ax-code/opentui-core"
import presets, { type SpinnerName, getSpinnerPreset } from "./presets.js"
import type { ColorGenerator } from "./utils.js"

export type { ColorGenerator } from "./utils.js"
export { createPulse, createWave, createStatic, createRainbow } from "./utils.js"
export { type SpinnerName, type SpinnerPreset, getSpinnerPreset, getSpinnerNames, randomSpinner } from "./presets.js"

// Re-export preset map for advanced use (e.g. custom iteration)
export { presets }

type RenderLib = ReturnType<typeof resolveRenderLib>
type EncodedHandle = NonNullable<ReturnType<RenderLib["encodeUnicode"]>>

export interface SpinnerOptions
  extends Omit<RenderableOptions<SpinnerRenderable>, "width" | "height" | "buffered" | "live" | keyof LayoutOptions> {
  /** Use a named preset (e.g. "dots", "line", "arc"). Overrides `frames` and `interval`. */
  name?: SpinnerName
  /** Custom frame strings. Used when `name` is not set. */
  frames?: string[]
  /** Animation interval in milliseconds. Used when `name` is not set. */
  interval?: number
  /** Whether to start animating immediately. Default: `true`. */
  autoplay?: boolean
  /** Background color for the spinner area. */
  backgroundColor?: ColorInput
  /** Solid color or per-character color generator. */
  color?: ColorInput | ColorGenerator
}

const DEFAULT_FRAMES = presets.dots.frames
const DEFAULT_INTERVAL = presets.dots.interval

export class SpinnerRenderable extends Renderable {
  private _name: SpinnerName | undefined
  private _frames: string[]
  private _interval: number
  private _autoplay: boolean
  private _backgroundColor: ColorInput
  private _color: ColorInput | ColorGenerator
  private _currentFrameIndex = 0
  private _encodedFrames: Record<string, EncodedHandle | null> = {}
  private _lib = resolveRenderLib()
  private _intervalId: ReturnType<typeof setInterval> | null = null

  protected _defaultOptions = {
    name: "dots" as const,
    frames: [...DEFAULT_FRAMES],
    interval: DEFAULT_INTERVAL,
    autoplay: true as const,
    backgroundColor: "transparent",
    color: "white",
  }

  constructor(ctx: RenderContext, options: SpinnerOptions) {
    super(ctx, options)

    if (options.name) {
      const preset = getSpinnerPreset(options.name)
      if (!preset) {
        throw new Error(`Unknown spinner preset: "${options.name}"`)
      }
      this._name = options.name
      this._frames = [...preset.frames]
      this._interval = preset.interval
    } else {
      this._name = undefined
      this._frames = options.frames?.length ? [...options.frames] : [...DEFAULT_FRAMES]
      this._interval = options.interval ?? DEFAULT_INTERVAL
    }

    if (this._interval <= 0) {
      throw new Error(`Spinner interval must be positive, got ${this._interval}`)
    }

    this._autoplay = options.autoplay ?? true
    this._backgroundColor = options.backgroundColor ?? "transparent"
    this._color = options.color ?? "white"
    this.width = this._computeWidth()
    this.height = 1
    this._encodeFrames()
    if (this._autoplay) this.start()
  }

  // --- Frame encoding (native unicode width calculation) ---

  private _encodeFrames(): void {
    for (const frame of this._frames) {
      const encoded = this._lib.encodeUnicode(frame, this.ctx.widthMethod)
      if (encoded) {
        this._encodedFrames[frame] = encoded
      }
    }
  }

  private _freeFrames(): void {
    for (const frame in this._encodedFrames) {
      const encoded = this._encodedFrames[frame]
      if (encoded) this._lib.freeUnicode(encoded)
    }
    this._encodedFrames = {}
  }

  private _computeWidth(): number {
    let max = 0
    for (const frame of this._frames) {
      if (frame.length > max) max = frame.length
    }
    return max
  }

  // --- Public API ---

  get interval(): number {
    return this._interval
  }

  set interval(value: number) {
    if (value <= 0) return
    const wasRunning = this._intervalId !== null
    this.stop()
    this._interval = value
    if (wasRunning) this.start()
  }

  get name(): SpinnerName | undefined {
    return this._name
  }

  set name(value: SpinnerName | undefined) {
    if (value !== undefined) {
      const preset = getSpinnerPreset(value)
      if (!preset) return
      this._freeFrames()
      this._name = value
      this._frames = [...preset.frames]
      this._interval = preset.interval
    } else {
      this._freeFrames()
      this._name = undefined
      this._frames = [...DEFAULT_FRAMES]
      this._interval = DEFAULT_INTERVAL
    }
    this.width = this._computeWidth()
    this._encodeFrames()
    this.requestRender()
  }

  get frames(): string[] {
    return this._frames
  }

  set frames(value: string[]) {
    this._freeFrames()
    this._frames = value.length === 0 ? [...DEFAULT_FRAMES] : [...value]
    this._encodeFrames()
    this.width = this._computeWidth()
    this.requestRender()
  }

  get color(): ColorInput | ColorGenerator {
    return this._color
  }

  set color(value: ColorInput | ColorGenerator) {
    this._color = value
    this.requestRender()
  }

  get backgroundColor(): ColorInput {
    return this._backgroundColor
  }

  set backgroundColor(value: ColorInput) {
    this._backgroundColor = value
    this.requestRender()
  }

  /** Whether the spinner animation is currently running. */
  get running(): boolean {
    return this._intervalId !== null
  }

  /** Current frame index in the animation cycle. */
  get currentFrameIndex(): number {
    return this._currentFrameIndex
  }

  start(): void {
    if (this._intervalId) return
    this._intervalId = setInterval(() => {
      this._currentFrameIndex = (this._currentFrameIndex + 1) % this._frames.length
      this.requestRender()
    }, this._interval)
  }

  stop(): void {
    if (this._intervalId) {
      clearInterval(this._intervalId)
      this._intervalId = null
    }
  }

  /** Reset the animation to the first frame. */
  reset(): void {
    this._currentFrameIndex = 0
    this.requestRender()
  }

  // --- Rendering ---

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible) return

    const frame = this._frames[this._currentFrameIndex]
    if (!frame) return

    const encoded = this._encodedFrames[frame]
    if (!encoded) return

    let x = this.x
    for (let i = 0; i < encoded.data.length; i++) {
      const glyph = encoded.data[i]!
      const resolvedColor =
        typeof this._color === "function"
          ? this._color(this._currentFrameIndex, i, this._frames.length, encoded.data.length)
          : this._color
      buffer.drawChar(glyph.char, x, this.y, parseColor(resolvedColor), parseColor(this._backgroundColor))
      x += glyph.width
    }
  }

  protected destroySelf(): void {
    this.stop()
    this._freeFrames()
    super.destroySelf()
  }
}
