import { type RenderableOptions, Renderable } from "../core/renderable.js"
import { clamp } from "../lib/clamp.js"
import { type RenderContext } from "../core/types.js"
import { type ColorInput, RGBA, parseColor } from "../lib/rgba.js"
import { OptimizedBuffer } from "../core/buffer.js"

const defaultThumbBackgroundColor = RGBA.fromHex("#9a9ea3")
const defaultTrackBackgroundColor = RGBA.fromHex("#252527")

const sanitizeBound = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback

export interface SliderOptions extends RenderableOptions<SliderRenderable> {
  orientation: "vertical" | "horizontal"
  value?: number
  min?: number
  max?: number
  viewPortSize?: number
  clampViewPortToRange?: boolean
  backgroundColor?: ColorInput
  foregroundColor?: ColorInput
  onChange?: (value: number) => void
}

export class SliderRenderable extends Renderable {
  public readonly orientation: "vertical" | "horizontal"
  private _value: number
  private _min: number
  private _max: number
  private _viewPortSize: number
  private _clampViewPortToRange: boolean
  private _backgroundColor: RGBA
  private _foregroundColor: RGBA
  private _onChange?: (value: number) => void

  constructor(ctx: RenderContext, options: SliderOptions) {
    super(ctx, { flexShrink: 0, ...options })
    this.orientation = options.orientation
    this._min = sanitizeBound(options.min, 0)
    this._max = sanitizeBound(options.max, 100)
    this._clampViewPortToRange = options.clampViewPortToRange ?? true
    this._value = clamp(options.value ?? this._min, this._min, this._max)
    const requestedViewPortSize = options.viewPortSize
    this._viewPortSize =
      requestedViewPortSize !== undefined && Number.isFinite(requestedViewPortSize)
        ? this.clampViewPort(requestedViewPortSize)
        : Math.max(1, (this._max - this._min) * 0.1)
    this._onChange = options.onChange
    this._backgroundColor = options.backgroundColor ? parseColor(options.backgroundColor) : defaultTrackBackgroundColor
    this._foregroundColor = options.foregroundColor ? parseColor(options.foregroundColor) : defaultThumbBackgroundColor

    this.setupMouseHandling()
  }

  get value(): number {
    return this._value
  }

  set value(newValue: number) {
    const clamped = clamp(newValue, this._min, this._max)
    if (clamped !== this._value) {
      this._value = clamped
      this._onChange?.(clamped)
      this.emit("change", { value: clamped })
      this.requestRender()
    }
  }

  get min(): number {
    return this._min
  }

  set min(newMin: number) {
    const sanitized = sanitizeBound(newMin, 0)
    if (sanitized !== this._min) {
      this._min = sanitized
      if (this._value < sanitized) {
        this.value = sanitized
      }
      this._viewPortSize = this.clampViewPort(this._viewPortSize)
      this.requestRender()
    }
  }

  get max(): number {
    return this._max
  }

  set max(newMax: number) {
    const sanitized = sanitizeBound(newMax, 100)
    if (sanitized !== this._max) {
      this._max = sanitized
      if (this._value > sanitized) {
        this.value = sanitized
      }
      this._viewPortSize = this.clampViewPort(this._viewPortSize)
      this.requestRender()
    }
  }

  set viewPortSize(size: number) {
    const clampedSize = this.clampViewPort(size)
    if (clampedSize !== this._viewPortSize) {
      this._viewPortSize = clampedSize
      this.requestRender()
    }
  }

  get viewPortSize(): number {
    return this._viewPortSize
  }

  // Scroll bars opt out of the range cap: their viewport is a real content
  // window that may legitimately exceed the scroll range (near-fit content),
  // and capping it would collapse the thumb to a sliver.
  private clampViewPort(size: number): number {
    if (this._clampViewPortToRange) {
      return clamp(size, 0.01, this._max - this._min)
    }
    if (!Number.isFinite(size)) return 0.01
    return clamp(size, 0.01, Number.POSITIVE_INFINITY)
  }

  get backgroundColor(): RGBA {
    return this._backgroundColor
  }

  set backgroundColor(value: ColorInput) {
    this._backgroundColor = parseColor(value)
    this.requestRender()
  }

  get foregroundColor(): RGBA {
    return this._foregroundColor
  }

  set foregroundColor(value: ColorInput) {
    this._foregroundColor = parseColor(value)
    this.requestRender()
  }

  private calculateDragOffsetVirtual(event: any): number {
    const trackStart = this.orientation === "vertical" ? this.y : this.x
    const mousePos = (this.orientation === "vertical" ? event.y : event.x) - trackStart
    const virtualMousePos = clamp(
      mousePos * 2,
      0,
      (this.orientation === "vertical" ? this.height : this.width) * 2,
    )
    const virtualThumbStart = this.getVirtualThumbStart()
    const virtualThumbSize = this.getVirtualThumbSize()

    return clamp(virtualMousePos - virtualThumbStart, 0, virtualThumbSize)
  }

  private setupMouseHandling(): void {
    let isDragging = false
    let dragOffsetVirtual = 0

    this.onMouseDown = (event) => {
      event.stopPropagation()
      event.preventDefault()

      const thumb = this.getThumbRect()
      const inThumb =
        event.x >= thumb.x && event.x < thumb.x + thumb.width && event.y >= thumb.y && event.y < thumb.y + thumb.height

      if (inThumb) {
        isDragging = true

        dragOffsetVirtual = this.calculateDragOffsetVirtual(event)
      } else {
        this.updateValueFromMouseDirect(event)
        isDragging = true

        dragOffsetVirtual = this.calculateDragOffsetVirtual(event)
      }
    }

    this.onMouseDrag = (event) => {
      if (!isDragging) return
      event.stopPropagation()
      this.updateValueFromMouseWithOffset(event, dragOffsetVirtual)
    }

    this.onMouseUp = (event) => {
      if (isDragging) {
        this.updateValueFromMouseWithOffset(event, dragOffsetVirtual)
      }
      isDragging = false
    }
  }

  private updateValueFromMouseDirect(event: any): void {
    const trackStart = this.orientation === "vertical" ? this.y : this.x
    const trackSize = this.orientation === "vertical" ? this.height : this.width
    const mousePos = this.orientation === "vertical" ? event.y : event.x

    const relativeMousePos = mousePos - trackStart
    const clampedMousePos = clamp(relativeMousePos, 0, trackSize)
    const ratio = trackSize === 0 ? 0 : clampedMousePos / trackSize
    const range = this._max - this._min
    const newValue = this._min + ratio * range

    this.value = newValue
  }

  private updateValueFromMouseWithOffset(event: any, offsetVirtual: number): void {
    const trackStart = this.orientation === "vertical" ? this.y : this.x
    const trackSize = this.orientation === "vertical" ? this.height : this.width
    const mousePos = this.orientation === "vertical" ? event.y : event.x

    const virtualTrackSize = trackSize * 2
    const relativeMousePos = mousePos - trackStart
    const clampedMousePos = clamp(relativeMousePos, 0, trackSize)
    const virtualMousePos = clampedMousePos * 2

    const virtualThumbSize = this.getVirtualThumbSize()
    const maxThumbStart = Math.max(0, virtualTrackSize - virtualThumbSize)

    let desiredThumbStart = virtualMousePos - offsetVirtual
    desiredThumbStart = clamp(desiredThumbStart, 0, maxThumbStart)

    const ratio = maxThumbStart === 0 ? 0 : desiredThumbStart / maxThumbStart
    const range = this._max - this._min
    const newValue = this._min + ratio * range

    this.value = newValue
  }

  private getThumbRect(): { x: number; y: number; width: number; height: number } {
    const virtualThumbSize = this.getVirtualThumbSize()
    const virtualThumbStart = this.getVirtualThumbStart()

    const realThumbStart = Math.floor(virtualThumbStart / 2)
    const realThumbSize = Math.ceil((virtualThumbStart + virtualThumbSize) / 2) - realThumbStart

    if (this.orientation === "vertical") {
      return {
        x: this.x,
        y: this.y + realThumbStart,
        width: this.width,
        height: Math.max(1, realThumbSize),
      }
    } else {
      return {
        x: this.x + realThumbStart,
        y: this.y,
        width: Math.max(1, realThumbSize),
        height: this.height,
      }
    }
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this.orientation === "horizontal") {
      this.renderHorizontal(buffer)
    } else {
      this.renderVertical(buffer)
    }
  }

  private renderHorizontal(buffer: OptimizedBuffer): void {
    const virtualThumbSize = this.getVirtualThumbSize()
    const virtualThumbStart = this.getVirtualThumbStart()
    const virtualThumbEnd = virtualThumbStart + virtualThumbSize

    buffer.fillRect(this.x, this.y, this.width, this.height, this._backgroundColor)

    const realStartCell = Math.floor(virtualThumbStart / 2)
    const realEndCell = Math.ceil(virtualThumbEnd / 2) - 1
    const startX = Math.max(0, realStartCell)
    const endX = Math.min(this.width - 1, realEndCell)

    for (let realX = startX; realX <= endX; realX++) {
      const virtualCellStart = realX * 2
      const virtualCellEnd = virtualCellStart + 2

      const thumbStartInCell = Math.max(virtualThumbStart, virtualCellStart)
      const thumbEndInCell = Math.min(virtualThumbEnd, virtualCellEnd)
      const coverage = thumbEndInCell - thumbStartInCell
      const char = coverage >= 2 ? "█" : thumbStartInCell === virtualCellStart ? "▌" : "▐"

      for (let y = 0; y < this.height; y++) {
        buffer.setCellWithAlphaBlending(this.x + realX, this.y + y, char, this._foregroundColor, this._backgroundColor)
      }
    }
  }

  private renderVertical(buffer: OptimizedBuffer): void {
    const virtualThumbSize = this.getVirtualThumbSize()
    const virtualThumbStart = this.getVirtualThumbStart()
    const virtualThumbEnd = virtualThumbStart + virtualThumbSize

    buffer.fillRect(this.x, this.y, this.width, this.height, this._backgroundColor)

    const realStartCell = Math.floor(virtualThumbStart / 2)
    const realEndCell = Math.ceil(virtualThumbEnd / 2) - 1
    const startY = Math.max(0, realStartCell)
    const endY = Math.min(this.height - 1, realEndCell)

    for (let realY = startY; realY <= endY; realY++) {
      const virtualCellStart = realY * 2
      const virtualCellEnd = virtualCellStart + 2

      const thumbStartInCell = Math.max(virtualThumbStart, virtualCellStart)
      const thumbEndInCell = Math.min(virtualThumbEnd, virtualCellEnd)
      const coverage = thumbEndInCell - thumbStartInCell

      let char = " "

      if (coverage >= 2) {
        char = "█"
      } else if (coverage > 0) {
        const virtualPositionInCell = thumbStartInCell - virtualCellStart
        if (virtualPositionInCell === 0) {
          char = "▀"
        } else {
          char = "▄"
        }
      }

      for (let x = 0; x < this.width; x++) {
        buffer.setCellWithAlphaBlending(this.x + x, this.y + realY, char, this._foregroundColor, this._backgroundColor)
      }
    }
  }

  private getVirtualThumbSize(): number {
    const virtualTrackSize = this.orientation === "vertical" ? this.height * 2 : this.width * 2
    const range = this._max - this._min

    if (range === 0) return virtualTrackSize

    const viewportSize = Math.max(1, this._viewPortSize)
    const contentSize = range + viewportSize

    if (contentSize <= viewportSize) return virtualTrackSize

    const thumbRatio = viewportSize / contentSize
    const calculatedSize = Math.floor(virtualTrackSize * thumbRatio)

    return Math.max(1, Math.min(calculatedSize, virtualTrackSize))
  }

  private getVirtualThumbStart(): number {
    const virtualTrackSize = this.orientation === "vertical" ? this.height * 2 : this.width * 2
    const range = this._max - this._min

    if (range === 0) return 0

    const valueRatio = (this._value - this._min) / range
    const virtualThumbSize = this.getVirtualThumbSize()

    return Math.round(valueRatio * (virtualTrackSize - virtualThumbSize))
  }
}
