import { Renderable, parseColor } from "@defai-digital/ax-tui"
import type { OptimizedBuffer, RenderContext, RenderableOptions } from "@defai-digital/ax-tui"
import type { Cell } from "./cells.js"
import { layoutSparkline, type SparklineLayoutOptions } from "./sparkline.js"
import { layoutGauge, type GaugeLayoutOptions } from "./gauge.js"
import { layoutBarChart, type BarChartLayoutOptions } from "./barchart.js"
import { layoutChart, validateChartOptions, type AxisOptions, type ChartLayoutOptions, type Dataset } from "./chart.js"
import type { ColorInput } from "./types.js"

function paintCells(
  buffer: OptimizedBuffer,
  cells: readonly Cell[],
  offsetX: number,
  offsetY: number,
  defaultFg: ColorInput,
): void {
  for (const cell of cells) {
    buffer.drawText(
      cell.char,
      offsetX + cell.x,
      offsetY + cell.y,
      parseColor(cell.fg ?? defaultFg),
      parseColor(cell.bg ?? "transparent"),
    )
  }
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/** Sparkline options. */
export interface SparklineOptions extends RenderableOptions<SparklineRenderable>, SparklineLayoutOptions {}

/** Compact sparkline chart renderable. */
export class SparklineRenderable extends Renderable {
  private _layout: SparklineLayoutOptions

  constructor(ctx: RenderContext, options: SparklineOptions) {
    super(ctx, options)
    this._layout = {
      data: options.data ?? [],
      max: options.max,
      direction: options.direction,
      color: options.color,
      barColor: options.barColor,
      backgroundColor: options.backgroundColor,
    }
    this.width = options.width ?? "100%"
    this.height = options.height ?? 1
  }

  get data(): readonly (number | null | undefined)[] {
    return this._layout.data
  }

  set data(value: readonly (number | null | undefined)[]) {
    this._layout.data = value ?? []
    this.requestRender()
  }

  get max(): number | undefined {
    return this._layout.max
  }

  set max(value: number | undefined) {
    this._layout.max = value
    this.requestRender()
  }

  get direction(): "ltr" | "rtl" | undefined {
    return this._layout.direction
  }

  set direction(value: "ltr" | "rtl" | undefined) {
    this._layout.direction = value
    this.requestRender()
  }

  get color(): ColorInput | undefined {
    return this._layout.color
  }

  set color(value: ColorInput | undefined) {
    this._layout.color = value
    this.requestRender()
  }

  get backgroundColor(): ColorInput | undefined {
    return this._layout.backgroundColor
  }

  set backgroundColor(value: ColorInput | undefined) {
    this._layout.backgroundColor = value
    this.requestRender()
  }

  get barColor(): SparklineLayoutOptions["barColor"] {
    return this._layout.barColor
  }

  set barColor(value: SparklineLayoutOptions["barColor"]) {
    this._layout.barColor = value
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible) return
    // The layout inputs are mutable by reference (see the `data` getter), so a
    // cached frame could outlive the data it was computed from. Recompute on
    // every frame so each painted frame reflects the current state.
    paintCells(buffer, layoutSparkline(this._layout, this.width, this.height), this.x, this.y, "white")
  }
}

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

/** Gauge options. */
export interface GaugeOptions extends RenderableOptions<GaugeRenderable>, GaugeLayoutOptions {}

/** Horizontal gauge renderable. */
export class GaugeRenderable extends Renderable {
  private _layout: GaugeLayoutOptions

  constructor(ctx: RenderContext, options: GaugeOptions) {
    super(ctx, options)
    this._layout = {
      ratio: options.ratio,
      label: options.label,
      color: options.color,
      labelColor: options.labelColor,
      backgroundColor: options.backgroundColor,
      unicode: options.unicode,
    }
    this.width = options.width ?? "100%"
    this.height = options.height ?? 1
  }

  get ratio(): number | undefined {
    return this._layout.ratio
  }

  set ratio(value: number | undefined) {
    this._layout.ratio = value
    this.requestRender()
  }

  get label(): string | null | undefined {
    return this._layout.label
  }

  set label(value: string | null | undefined) {
    this._layout.label = value
    this.requestRender()
  }

  get color(): ColorInput | undefined {
    return this._layout.color
  }

  set color(value: ColorInput | undefined) {
    this._layout.color = value
    this.requestRender()
  }

  get labelColor(): GaugeLayoutOptions["labelColor"] {
    return this._layout.labelColor
  }

  set labelColor(value: GaugeLayoutOptions["labelColor"]) {
    this._layout.labelColor = value
    this.requestRender()
  }

  get backgroundColor(): GaugeLayoutOptions["backgroundColor"] {
    return this._layout.backgroundColor
  }

  set backgroundColor(value: GaugeLayoutOptions["backgroundColor"]) {
    this._layout.backgroundColor = value
    this.requestRender()
  }

  get unicode(): boolean | undefined {
    return this._layout.unicode
  }

  set unicode(value: boolean | undefined) {
    this._layout.unicode = value
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible) return
    paintCells(buffer, layoutGauge(this._layout, this.width, this.height), this.x, this.y, "white")
  }
}

// ---------------------------------------------------------------------------
// BarChart
// ---------------------------------------------------------------------------

/** Bar chart options. */
export interface BarChartOptions extends RenderableOptions<BarChartRenderable>, BarChartLayoutOptions {}

/** Bar-chart renderable. */
export class BarChartRenderable extends Renderable {
  private _layout: BarChartLayoutOptions

  constructor(ctx: RenderContext, options: BarChartOptions) {
    super(ctx, options)
    this._layout = {
      data: options.data ?? [],
      barWidth: options.barWidth,
      barGap: options.barGap,
      max: options.max,
      showValues: options.showValues,
      showLabels: options.showLabels,
      color: options.color,
      backgroundColor: options.backgroundColor,
    }
    this.width = options.width ?? "100%"
    this.height = options.height ?? 8
  }

  get data(): BarChartLayoutOptions["data"] {
    return this._layout.data
  }

  set data(value: BarChartLayoutOptions["data"]) {
    this._layout.data = value ?? []
    this.requestRender()
  }

  get barWidth(): number | undefined {
    return this._layout.barWidth
  }

  set barWidth(value: number | undefined) {
    this._layout.barWidth = value
    this.requestRender()
  }

  get barGap(): number | undefined {
    return this._layout.barGap
  }

  set barGap(value: number | undefined) {
    this._layout.barGap = value
    this.requestRender()
  }

  get max(): number | undefined {
    return this._layout.max
  }

  set max(value: number | undefined) {
    this._layout.max = value
    this.requestRender()
  }

  get showValues(): boolean | undefined {
    return this._layout.showValues
  }

  set showValues(value: boolean | undefined) {
    this._layout.showValues = value
    this.requestRender()
  }

  get showLabels(): boolean | undefined {
    return this._layout.showLabels
  }

  set showLabels(value: boolean | undefined) {
    this._layout.showLabels = value
    this.requestRender()
  }

  get color(): ColorInput | undefined {
    return this._layout.color
  }

  set color(value: ColorInput | undefined) {
    this._layout.color = value
    this.requestRender()
  }

  get backgroundColor(): BarChartLayoutOptions["backgroundColor"] {
    return this._layout.backgroundColor
  }

  set backgroundColor(value: BarChartLayoutOptions["backgroundColor"]) {
    this._layout.backgroundColor = value
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible) return
    // See SparklineRenderable: inputs are mutable by reference, so recompute on
    // every frame instead of caching a potentially stale frame.
    paintCells(buffer, layoutBarChart(this._layout, this.width, this.height), this.x, this.y, "white")
  }
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

/** Chart options. */
export interface ChartOptions extends RenderableOptions<ChartRenderable>, ChartLayoutOptions {}

/** Cartesian chart renderable with axes, legend, and markers. */
export class ChartRenderable extends Renderable {
  private _layout: ChartLayoutOptions

  constructor(ctx: RenderContext, options: ChartOptions) {
    super(ctx, options)
    validateChartOptions(options)
    this._layout = {
      datasets: options.datasets ?? [],
      xAxis: options.xAxis,
      yAxis: options.yAxis,
      legendPosition: options.legendPosition,
      hiddenLegendConstraints: options.hiddenLegendConstraints,
      color: options.color,
      backgroundColor: options.backgroundColor,
    }
    this.width = options.width ?? "100%"
    this.height = options.height ?? 10
  }

  get datasets(): readonly Dataset[] {
    return this._layout.datasets ?? []
  }

  set datasets(value: ChartLayoutOptions["datasets"]) {
    this._layout.datasets = value ?? []
    this.requestRender()
  }

  get xAxis(): AxisOptions | undefined {
    return this._layout.xAxis
  }

  set xAxis(value: AxisOptions | undefined) {
    validateChartOptions({ xAxis: value })
    this._layout.xAxis = value
    this.requestRender()
  }

  get yAxis(): AxisOptions | undefined {
    return this._layout.yAxis
  }

  set yAxis(value: AxisOptions | undefined) {
    validateChartOptions({ yAxis: value })
    this._layout.yAxis = value
    this.requestRender()
  }

  get legendPosition(): ChartLayoutOptions["legendPosition"] {
    return this._layout.legendPosition
  }

  set legendPosition(value: ChartLayoutOptions["legendPosition"]) {
    this._layout.legendPosition = value
    this.requestRender()
  }

  get hiddenLegendConstraints(): ChartLayoutOptions["hiddenLegendConstraints"] {
    return this._layout.hiddenLegendConstraints
  }

  set hiddenLegendConstraints(value: ChartLayoutOptions["hiddenLegendConstraints"]) {
    this._layout.hiddenLegendConstraints = value
    this.requestRender()
  }

  get color(): ColorInput | undefined {
    return this._layout.color
  }

  set color(value: ColorInput | undefined) {
    this._layout.color = value
    this.requestRender()
  }

  get backgroundColor(): ChartLayoutOptions["backgroundColor"] {
    return this._layout.backgroundColor
  }

  set backgroundColor(value: ChartLayoutOptions["backgroundColor"]) {
    this._layout.backgroundColor = value
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible) return
    // See SparklineRenderable: datasets are mutable by reference, so recompute
    // on every frame instead of caching a potentially stale frame.
    paintCells(buffer, layoutChart(this._layout, this.width, this.height), this.x, this.y, "white")
  }
}
