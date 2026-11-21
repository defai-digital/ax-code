import type { OptimizedBuffer } from "../core/buffer.js"
import { parseColor, RGBA, type ColorInput } from "../lib/index.js"
import { clamp } from "../lib/clamp.js"
import type { KeyEvent } from "../lib/key-handler.js"
import { stringWidth } from "../platform/runtime.js"
import { Renderable, type RenderableOptions } from "../core/renderable.js"
import { CliRenderEvents, type RenderContext, type Timeout } from "../core/types.js"
import { type BoxOptions } from "./Box.js"
import { SliderRenderable, type SliderOptions } from "./Slider.js"

export interface ScrollBarOptions extends RenderableOptions<ScrollBarRenderable> {
  focusable?: boolean
  orientation: "vertical" | "horizontal"
  showArrows?: boolean
  arrowOptions?: Omit<ArrowOptions, "direction">
  trackOptions?: Partial<SliderOptions>
  onChange?: (position: number) => void
}

export type ScrollUnit = "absolute" | "viewport" | "content" | "step"

export class ScrollBarRenderable extends Renderable {
  public readonly slider: SliderRenderable
  public readonly startArrow: ArrowRenderable
  public readonly endArrow: ArrowRenderable
  public readonly orientation: "vertical" | "horizontal"

  private _scrollSize = 0
  private _scrollPosition = 0
  private _viewportSize = 0
  private _showArrows = false
  private _manualVisibility = false

  private _onChange: ((position: number) => void) | undefined

  private arrowRepeatTimer: Timeout | undefined

  private readonly stopArrowRepeat = (): void => {
    if (this.arrowRepeatTimer === undefined) return
    clearTimeout(this.arrowRepeatTimer)
    clearInterval(this.arrowRepeatTimer)
    this.arrowRepeatTimer = undefined
    this._ctx.off(CliRenderEvents.MOUSE_UP, this.stopArrowRepeat)
  }

  private startArrowRepeat(direction: -1 | 1): void {
    this.stopArrowRepeat()
    const delay = setTimeout(() => {
      this.scrollBy(direction * 0.5, "viewport")
      if (this.arrowRepeatTimer === delay) {
        this.arrowRepeatTimer = setInterval(() => this.scrollBy(direction * 0.2, "viewport"), 200)
      }
    }, 500)
    this.arrowRepeatTimer = delay
    // A release outside the arrow may only reach the renderer. Subscribe
    // while pressed so idle and hidden scrollbars do not accumulate listeners.
    this._ctx.on(CliRenderEvents.MOUSE_UP, this.stopArrowRepeat)
    this.scrollBy(direction * 0.5, "viewport")
  }

  scrollStep: number | undefined | null = null

  get visible(): boolean {
    return super.visible
  }

  set visible(value: boolean) {
    this._manualVisibility = true
    super.visible = value
  }

  public resetVisibilityControl(): void {
    this._manualVisibility = false
    this.recalculateVisibility()
  }

  get scrollSize(): number {
    return this._scrollSize
  }

  get scrollPosition(): number {
    return this._scrollPosition
  }

  get viewportSize(): number {
    return this._viewportSize
  }

  set scrollSize(value: number) {
    if (value === this.scrollSize) return
    this._scrollSize = value
    this.recalculateVisibility()
    this.updateSliderFromScrollState()
    this.scrollPosition = this.scrollPosition
  }

  set scrollPosition(value: number) {
    // Upper bound is floored at 0 so a viewport larger than the content can
    // never push the stored position negative (previously the raw
    // `scrollSize - viewportSize` upper bound could).
    const newPosition = Math.round(clamp(value, 0, Math.max(0, this.scrollSize - this.viewportSize)))
    if (newPosition !== this._scrollPosition) {
      this._scrollPosition = newPosition
      this.updateSliderFromScrollState()
      // Events are triggered by the slider change event
      // this._onChange?.(newPosition)
      // this.emit("change", { position: newPosition })
    }
  }

  set viewportSize(value: number) {
    if (value === this.viewportSize) return
    this._viewportSize = value
    this.slider.viewPortSize = Math.max(1, this._viewportSize)
    this.recalculateVisibility()
    this.updateSliderFromScrollState()
    this.scrollPosition = this.scrollPosition
  }

  get showArrows(): boolean {
    return this._showArrows
  }

  set showArrows(value: boolean) {
    if (value === this._showArrows) return
    this._showArrows = value
    this.startArrow.visible = value
    this.endArrow.visible = value
  }

  constructor(
    ctx: RenderContext,
    { trackOptions, arrowOptions, orientation, showArrows = false, ...options }: ScrollBarOptions,
  ) {
    super(ctx, {
      flexDirection: orientation === "vertical" ? "column" : "row",
      alignSelf: "stretch",
      alignItems: "stretch",
      ...(options as BoxOptions),
    })

    // The parent field starts false. Scroll bars are focusable unless told otherwise.
    this._focusable = options.focusable ?? true

    this._onChange = options.onChange

    this.orientation = orientation
    this._showArrows = showArrows

    const scrollRange = Math.max(0, this._scrollSize - this._viewportSize)

    const defaultStepSize = Math.max(1, this._viewportSize)
    const stepSize = trackOptions?.viewPortSize ?? defaultStepSize

    // Orientation belongs to the scroll bar; the slider must keep the ctor axis.
    // onChange belongs to the scroll bar too: a trackOptions.onChange must not
    // clobber the internal slider onChange that forwards scroll position.
    const sliderTrackOptions = { ...trackOptions }
    delete sliderTrackOptions.orientation
    delete sliderTrackOptions.onChange

    this.slider = new SliderRenderable(ctx, {
      orientation,
      min: 0,
      max: scrollRange,
      value: this._scrollPosition,
      viewPortSize: stepSize,
      onChange: (value) => {
        this._scrollPosition = Math.round(value)
        this._onChange?.(this._scrollPosition)
        this.emit("change", { position: this._scrollPosition })
      },
      ...(orientation === "vertical"
        ? {
            width: Math.max(1, Math.min(2, this.width)),
            height: "100%",
            marginLeft: "auto",
          }
        : {
            width: "100%",
            height: 1,
            marginTop: "auto",
          }),
      flexGrow: 1,
      flexShrink: 1,
      ...sliderTrackOptions,
      clampViewPortToRange: false,
    })

    this.updateSliderFromScrollState()

    const arrowOpts = arrowOptions
      ? {
          foregroundColor: arrowOptions.foregroundColor,
          backgroundColor: arrowOptions.backgroundColor,
          attributes: arrowOptions.attributes,
          ...arrowOptions,
        }
      : {}

    this.startArrow = new ArrowRenderable(ctx, {
      alignSelf: "center",
      visible: this.showArrows,
      direction: this.orientation === "vertical" ? "up" : "left",
      height: this.orientation === "vertical" ? 1 : 1,
      ...arrowOpts,
    })

    this.endArrow = new ArrowRenderable(ctx, {
      alignSelf: "center",
      visible: this.showArrows,
      direction: this.orientation === "vertical" ? "down" : "right",
      height: this.orientation === "vertical" ? 1 : 1,
      ...arrowOpts,
    })

    this.add(this.startArrow)
    this.add(this.slider)
    this.add(this.endArrow)

    this.startArrow.onMouseDown = (event) => {
      event.stopPropagation()
      event.preventDefault()
      this.startArrowRepeat(-1)
    }

    this.startArrow.onMouseUp = (event) => {
      event.stopPropagation()
      this.stopArrowRepeat()
    }

    this.endArrow.onMouseDown = (event) => {
      event.stopPropagation()
      event.preventDefault()
      this.startArrowRepeat(1)
    }

    this.endArrow.onMouseUp = (event) => {
      event.stopPropagation()
      this.stopArrowRepeat()
    }
  }

  protected destroySelf(): void {
    this.stopArrowRepeat()
  }

  public set arrowOptions(options: ScrollBarOptions["arrowOptions"]) {
    if (options) {
      const arrowOpts = { ...options }
      // The arrows' press-and-hold repeat scrolling is internal wiring;
      // arrowOptions may style the arrows but must not replace it.
      delete arrowOpts.onMouseDown
      delete arrowOpts.onMouseUp
      Object.assign(this.startArrow, arrowOpts)
      Object.assign(this.endArrow, arrowOpts)
    }
    this.requestRender()
  }

  public set trackOptions(options: ScrollBarOptions["trackOptions"]) {
    if (options) {
      const sliderOptions = { ...options }
      delete sliderOptions.orientation
      delete sliderOptions.clampViewPortToRange
      // The slider's change forwarding and drag handlers are internal wiring;
      // trackOptions may style the track but must not replace them.
      delete sliderOptions.onChange
      delete sliderOptions.onMouseDown
      delete sliderOptions.onMouseDrag
      delete sliderOptions.onMouseUp
      Object.assign(this.slider, sliderOptions)
    }
    this.updateSliderFromScrollState()
    this.requestRender()
  }

  private updateSliderFromScrollState(): void {
    const scrollRange = Math.max(0, this._scrollSize - this._viewportSize)

    this.slider.min = 0
    this.slider.max = scrollRange

    // The slider keeps the viewport unclamped (clampViewPortToRange: false), so
    // near-fit content keeps a full-size thumb. Re-forward the real viewport on
    // every state change; an unknown viewport collapses to the minimal thumb
    // instead of fabricating one.
    if (this._viewportSize > 0) {
      this.slider.viewPortSize = Math.max(1, this._viewportSize)
    } else {
      this.slider.viewPortSize = 0.01
    }

    this.slider.value = Math.min(this._scrollPosition, scrollRange)
  }

  public scrollBy(delta: number, unit: ScrollUnit = "absolute"): void {
    const multiplier =
      unit === "viewport"
        ? this.viewportSize
        : unit === "content"
          ? this.scrollSize
          : unit === "step"
            ? (this.scrollStep ?? 1)
            : 1

    const resolvedDelta = multiplier * delta
    if (!Number.isFinite(resolvedDelta) || resolvedDelta === 0) return
    // The position setter rounds to whole rows, which would swallow fractional
    // deltas (arrow keys with a tiny viewport); apply at least one row instead.
    this.scrollPosition += Math.sign(resolvedDelta) * Math.max(1, Math.abs(resolvedDelta))
  }

  private recalculateVisibility(): void {
    if (!this._manualVisibility) {
      const sizeRatio = this.scrollSize <= this.viewportSize ? 1 : this.viewportSize / this.scrollSize
      super.visible = sizeRatio < 1
    }
  }

  public handleKeyPress(key: KeyEvent): boolean {
    // A scrollbar with nothing to scroll must not swallow paging/navigation
    // keys that belong to a sibling axis or the host application.
    if (this.scrollSize <= this.viewportSize) return false

    switch (key.name) {
      case "left":
      case "h":
        if (this.orientation !== "horizontal") return false
        this.scrollBy(-1 / 5, "viewport")
        return true
      case "right":
      case "l":
        if (this.orientation !== "horizontal") return false
        this.scrollBy(1 / 5, "viewport")
        return true
      case "up":
      case "k":
        if (this.orientation !== "vertical") return false
        this.scrollBy(-1 / 5, "viewport")
        return true
      case "down":
      case "j":
        if (this.orientation !== "vertical") return false
        this.scrollBy(1 / 5, "viewport")
        return true
      case "pageup":
        this.scrollBy(-1 / 2, "viewport")
        return true
      case "pagedown":
        this.scrollBy(1 / 2, "viewport")
        return true
      case "home":
        this.scrollBy(-1, "content")
        return true
      case "end":
        this.scrollBy(1, "content")
        return true
    }

    return false
  }
}

export interface ArrowOptions extends RenderableOptions<ArrowRenderable> {
  direction: "up" | "down" | "left" | "right"
  foregroundColor?: ColorInput
  backgroundColor?: ColorInput
  attributes?: number
  arrowChars?: {
    up?: string
    down?: string
    left?: string
    right?: string
  }
}

export class ArrowRenderable extends Renderable {
  private _direction: "up" | "down" | "left" | "right"
  private _foregroundColor: RGBA
  private _backgroundColor: RGBA
  private _attributes: number
  private _arrowChars: {
    up: string
    down: string
    left: string
    right: string
  }

  constructor(ctx: RenderContext, options: ArrowOptions) {
    super(ctx, options)
    this._direction = options.direction
    this._foregroundColor = options.foregroundColor ? parseColor(options.foregroundColor) : RGBA.fromValues(1, 1, 1, 1)
    this._backgroundColor = options.backgroundColor ? parseColor(options.backgroundColor) : RGBA.fromValues(0, 0, 0, 0)
    this._attributes = options.attributes ?? 0

    this._arrowChars = {
      up: "▲",
      down: "▼",
      left: "◀",
      right: "▶",
      ...options.arrowChars,
    }

    if (!options.width) {
      this.width = stringWidth(this.getArrowChar())
    }
  }

  get direction(): "up" | "down" | "left" | "right" {
    return this._direction
  }

  set direction(value: "up" | "down" | "left" | "right") {
    if (this._direction !== value) {
      this._direction = value
      this.requestRender()
    }
  }

  get foregroundColor(): RGBA {
    return this._foregroundColor
  }

  set foregroundColor(value: ColorInput) {
    if (this._foregroundColor !== value) {
      this._foregroundColor = parseColor(value)
      this.requestRender()
    }
  }

  get backgroundColor(): RGBA {
    return this._backgroundColor
  }

  set backgroundColor(value: ColorInput) {
    if (this._backgroundColor !== value) {
      this._backgroundColor = parseColor(value)
      this.requestRender()
    }
  }

  get attributes(): number {
    return this._attributes
  }

  set attributes(value: number) {
    if (this._attributes !== value) {
      this._attributes = value
      this.requestRender()
    }
  }

  set arrowChars(value: ArrowOptions["arrowChars"]) {
    this._arrowChars = {
      ...this._arrowChars,
      ...value,
    }
    this.requestRender()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const char = this.getArrowChar()
    buffer.drawText(char, this.x, this.y, this._foregroundColor, this._backgroundColor, this._attributes)
  }

  private getArrowChar(): string {
    switch (this._direction) {
      case "up":
        return this._arrowChars.up
      case "down":
        return this._arrowChars.down
      case "left":
        return this._arrowChars.left
      case "right":
        return this._arrowChars.right
      default:
        return "?"
    }
  }
}
