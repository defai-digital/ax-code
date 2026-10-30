import type { Cell } from "./cells.js"
import { compositeCells, paintText } from "./cells.js"
import { createGrid } from "./grid.js"
import { getPoint, strokeSegment, type Bounds } from "./painter.js"
import {
  BOX_BOTTOM_LEFT,
  BOX_BOTTOM_RIGHT,
  BOX_TOP_LEFT,
  BOX_TOP_RIGHT,
  LINE_BOTTOM_LEFT,
  LINE_HORIZONTAL,
  LINE_VERTICAL,
} from "./symbols.js"
import type { ColorInput, GraphType, Marker } from "./types.js"

/** Dataset. */
export interface Dataset {
  /** Legend name; datasets without a name do not appear in the legend. */
  name?: string
  /** World-space points; non-finite pairs are filtered before layout math. */
  data: ReadonlyArray<readonly [number, number]>
  /** Marker resolution. Default "braille" (ratatui Canvas default). */
  marker?: Marker
  /** Connection strategy. Default "scatter" (ratatui Dataset default). */
  graphType?: GraphType
  /** Series color. Default "white". */
  color?: ColorInput
}

/** Labels alignment. */
export type LabelsAlignment = "left" | "center" | "right"

/** Axis options. */
export interface AxisOptions {
  /** REQUIRED finite [min, max] when an axis object is provided. */
  bounds?: readonly [number, number]
  /** Tick labels; axis lines render only when labels exist (ratatui v0.30 rule). */
  labels?: readonly string[]
  /** Axis title; requires graph height > 2 and must fit (ratatui rule). */
  title?: string
  /** Default "left" (ratatui Alignment::Left). On the x axis this only affects the FIRST label. */
  labelsAlignment?: LabelsAlignment
  /** Axis line/label/title color. Default: the chart color. */
  color?: ColorInput
}

/** Legend position. */
export type LegendPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left" | "none"

/** Chart layout options. */
export interface ChartLayoutOptions {
  datasets?: readonly Dataset[]
  xAxis?: AxisOptions
  yAxis?: AxisOptions
  /** Default "top-right"; auto-hides when the legend exceeds the hidden-legend constraints. */
  legendPosition?: LegendPosition
  /** [widthRatio, heightRatio] of the graph area. Default [1/4, 1/4] (ratatui parity). */
  hiddenLegendConstraints?: readonly [number, number]
  /** Default axis/label/title/legend-border color. Default "white". */
  color?: ColorInput
  /** Background painted across the whole widget area. */
  backgroundColor?: ColorInput
}

function isFinitePair(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isFinite(value[0] as number) &&
    Number.isFinite(value[1] as number)
  )
}

/**
 * Validate the bounds contract: when an axis object is provided, its bounds
 * are required and must be a finite pair. This is the one hard error — all
 * other degenerate input renders nothing without throwing.
 */
export function validateChartOptions(options: ChartLayoutOptions): void {
  for (const [name, axis] of [
    ["xAxis", options.xAxis],
    ["yAxis", options.yAxis],
  ] as const) {
    if (axis !== undefined && !isFinitePair(axis.bounds)) {
      throw new TypeError(`chart ${name}.bounds must be a finite [min, max] pair when ${name} is provided`)
    }
  }
}

/**
 * Auto bounds over one coordinate of every finite point (documented deviation:
 * ratatui requires explicit axes). Computed in a single pass so the combined
 * point list and the per-coordinate arrays are never materialized — the data
 * stage re-filters each dataset independently, so building them here is pure
 * allocation waste.
 */
function autoBoundsOf(datasets: readonly Dataset[], coord: 0 | 1): [number, number] {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const dataset of datasets) {
    for (const point of dataset.data) {
      if (!isFinitePair(point)) continue
      const value = point[coord]
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) return [min - 0.5, max + 0.5]
  return [min, max]
}

interface ChartLayout {
  cells: Cell[]
  graphLeft: number
  graphWidth: number
  graphHeight: number
}

/**
 * Chart layout (port of ratatui `Chart::layout` + `Chart::render` +
 * Canvas data pipeline). Stages: layout -> axis lines/labels -> data ->
 * titles -> legend. Text always paints over data (ratatui order).
 */
export function layoutChart(options: ChartLayoutOptions, width: number, height: number): Cell[] {
  return layoutChartInternal(options, width, height).cells
}

/** Internal variant exposing the computed graph area (used by tests). */
export function layoutChartInternal(options: ChartLayoutOptions, width: number, height: number): ChartLayout {
  validateChartOptions(options)
  const cells: Cell[] = []
  if (width <= 0 || height <= 0) return { cells, graphLeft: 0, graphWidth: 0, graphHeight: 0 }

  const datasets = options.datasets ?? []
  const xAxis = options.xAxis
  const yAxis = options.yAxis
  const xLabels = xAxis?.labels ?? []
  const yLabels = yAxis?.labels ?? []
  const axisColor = options.color ?? "white"

  if (options.backgroundColor !== undefined) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) cells.push({ x, y, char: " ", bg: options.backgroundColor })
    }
  }

  // --- Bounds resolution -------------------------------------------------
  const bounds: Bounds = {
    x: (xAxis?.bounds as readonly [number, number] | undefined) ?? autoBoundsOf(datasets, 0),
    y: (yAxis?.bounds as readonly [number, number] | undefined) ?? autoBoundsOf(datasets, 1),
  }

  // --- Layout stage (faithful port) --------------------------------------
  let y = height - 1
  let labelRowX: number | null = null
  let axisRowX: number | null = null
  if (xLabels.length > 0 && y > 0) {
    labelRowX = y
    y -= 1
  }
  if (xLabels.length > 0 && y > 0) {
    axisRowX = y
    y -= 1
  }

  let axisColY: number | null = null
  let yLabelWidth = 0
  if (yLabels.length > 0) {
    let slot = 0
    for (const label of yLabels) slot = Math.max(slot, label.length)
    if (xLabels.length > 0) {
      // The first x label may intrude into the y-label slot (ratatui:
      // alignment Left => width - has_y_axis, Center => width / 2, Right => 0).
      const firstWidth = xLabels[0]!.length
      const alignment = xAxis?.labelsAlignment ?? "left"
      if (alignment === "left") slot += Math.max(firstWidth - 1, 0)
      else if (alignment === "center") slot += Math.floor(firstWidth / 2)
    }
    yLabelWidth = Math.min(slot, Math.floor(width / 3))
    if (yLabelWidth + 1 < width) {
      axisColY = yLabelWidth
    } else {
      yLabelWidth = 0
    }
  }

  const graphLeft = axisColY !== null ? axisColY + 1 : 0
  const graphWidth = width - graphLeft
  const graphHeight = y + 1
  if (graphWidth <= 0 || graphHeight <= 0) return { cells, graphLeft, graphWidth, graphHeight }

  // --- Axis lines (only when the corresponding axis has labels) ----------
  if (axisRowX !== null) {
    const from = axisColY !== null ? axisColY + 1 : graphLeft
    for (let x = from; x < width; x++) {
      cells.push({ x, y: axisRowX, char: LINE_HORIZONTAL, fg: xAxis?.color ?? axisColor })
    }
    if (axisColY !== null)
      cells.push({
        x: axisColY,
        y: axisRowX,
        char: LINE_BOTTOM_LEFT,
        fg: axisColor,
      })
  }
  if (axisColY !== null) {
    const bottom = axisRowX !== null ? axisRowX : graphHeight
    for (let row = 0; row < bottom; row++) {
      cells.push({ x: axisColY, y: row, char: LINE_VERTICAL, fg: yAxis?.color ?? axisColor })
    }
  }

  // --- Axis labels --------------------------------------------------------
  if (labelRowX !== null && xLabels.length >= 2) {
    const labelColor = xAxis?.color ?? axisColor
    const alignment = xAxis?.labelsAlignment ?? "left"
    const n = xLabels.length
    const tickWidth = Math.floor(graphWidth / n)
    const first = xLabels[0]!
    // First-label area (ratatui first_x_label_area), then aligned within the
    // area with the REVERSED alignment (Left -> right-aligned, Right -> left):
    //   Left:   [0, graphLeft) — empty without a y-axis slot, so omitted
    //   Center: [0, graphLeft + min(tickWidth, first.length))
    //   Right:  [graphLeft - 1, graphLeft + tickWidth)
    let areaX = 0
    let areaWidth = 0
    if (alignment === "left") {
      areaWidth = graphLeft
    } else if (alignment === "center") {
      areaWidth = graphLeft + Math.min(tickWidth, first.length)
    } else {
      areaX = Math.max(graphLeft - 1, 0)
      areaWidth = graphLeft + tickWidth - areaX
    }
    const shownFirst = first.length > areaWidth ? first.slice(0, areaWidth) : first
    if (shownFirst.length > 0) {
      let fx = areaX
      if (alignment === "left") fx = areaX + areaWidth - shownFirst.length
      else if (alignment === "center") fx = areaX + Math.floor((areaWidth - shownFirst.length) / 2)
      paintText(cells, shownFirst, fx, labelRowX, labelColor)
    }
    // Middle labels: centered in (graphLeft + i*tickWidth + 1, tickWidth - 1),
    // truncated to the area (ratatui render_x_labels).
    for (let i = 1; i < n - 1; i++) {
      if (tickWidth <= 1) continue
      const text = xLabels[i]!
      const areaMiddleX = graphLeft + i * tickWidth + 1
      const areaMiddleWidth = tickWidth - 1
      const shown = text.length > areaMiddleWidth ? text.slice(0, areaMiddleWidth) : text
      const lx = areaMiddleX + Math.floor((areaMiddleWidth - shown.length) / 2)
      if (lx < graphLeft || lx + shown.length > width) continue
      paintText(cells, shown, lx, labelRowX, labelColor)
    }
    const last = xLabels[n - 1]!
    if (last.length <= width) {
      const lx = width - last.length
      if (lx >= graphLeft) paintText(cells, last, lx, labelRowX, labelColor)
    }
  }
  if (axisColY !== null && yLabelWidth > 0 && yLabels.length >= 2 && graphHeight >= 2) {
    const labelColor = yAxis?.color ?? axisColor
    const alignment = yAxis?.labelsAlignment ?? "left"
    const n = yLabels.length
    const graphBottom = graphHeight - 1
    for (let i = 0; i < n; i++) {
      const dy = Math.floor((i * (graphHeight - 1)) / (n - 1))
      const row = graphBottom - dy // first label at the bottom, last at the top
      if (row < 0 || row >= height) continue
      const full = yLabels[i]!
      const text = full.length > yLabelWidth ? full.slice(0, yLabelWidth) : full
      let tx = 0
      if (alignment === "right") tx = yLabelWidth - text.length
      else if (alignment === "center") tx = Math.floor((yLabelWidth - text.length) / 2)
      paintText(cells, text, tx, row, labelColor)
    }
  }

  // --- Data stage (Canvas port) -------------------------------------------
  // ratatui v0.30 gives every dataset its own layer: `Context::marker()`
  // finishes the current grid and starts a fresh one for EACH dataset, even
  // when adjacent datasets share a marker. Layers composite per-attribute
  // (later wins), so a later braille dataset replaces the whole cell it
  // touches instead of merging dots with an earlier dataset.
  const layers: Cell[][] = []
  for (const dataset of datasets) {
    const datasetPoints = dataset.data.filter(isFinitePair) as [number, number][]
    if (datasetPoints.length === 0) continue
    const grid = createGrid(dataset.marker ?? "braille", graphWidth, graphHeight)
    const graphType: GraphType = dataset.graphType ?? "scatter"
    const color = dataset.color ?? "white"
    const paint = (px: number, py: number): void => grid.paint(px, py, color)

    // Points are always painted, for every graph type (ratatui behavior).
    for (const [wx, wy] of datasetPoints) {
      const pixel = getPoint(wx, wy, bounds, grid.resolution)
      if (pixel) paint(pixel.px, pixel.py)
    }
    if (graphType === "line") {
      for (let i = 0; i + 1 < datasetPoints.length; i++) {
        const a = datasetPoints[i]!
        const b = datasetPoints[i + 1]!
        strokeSegment(a[0], a[1], b[0], b[1], bounds, grid, paint)
      }
    } else if (graphType === "bar") {
      // Bar baseline is the VALUE 0.0, not the y-axis lower bound (ratatui).
      for (const [wx, wy] of datasetPoints) strokeSegment(wx, 0, wx, wy, bounds, grid, paint)
    }
    layers.push(grid.save())
  }
  for (const cell of compositeCells(layers)) {
    cells.push({ ...cell, x: cell.x + graphLeft, y: cell.y })
  }

  // --- Titles (require graphHeight > 2 and fit, ratatui rules) ------------
  if (graphHeight > 2) {
    const xTitle = xAxis?.title
    if (xTitle !== undefined && xTitle.length > 0 && xTitle.length < graphWidth) {
      const row = graphHeight // one below the graph bottom = the axis row when present
      if (row < height) paintText(cells, xTitle, width - xTitle.length, row, xAxis?.color ?? axisColor)
    }
    const yTitle = yAxis?.title
    if (yTitle !== undefined && yTitle.length > 0 && yTitle.length + 1 < graphWidth) {
      paintText(cells, yTitle, graphLeft, 0, yAxis?.color ?? axisColor)
    }
  }

  // --- Legend --------------------------------------------------------------
  const legendPosition = options.legendPosition ?? "top-right"
  if (legendPosition !== "none") {
    const named = datasets.filter((dataset) => dataset.name !== undefined && dataset.name.length > 0)
    if (named.length > 0) {
      let innerWidth = 0
      for (const dataset of named) innerWidth = Math.max(innerWidth, dataset.name!.length)
      const legendWidth = innerWidth + 2
      const legendHeight = named.length + 2
      const [ratioW, ratioH] = options.hiddenLegendConstraints ?? [0.25, 0.25]
      const maxWidth = Math.floor(graphWidth * ratioW)
      const maxHeight = Math.floor(graphHeight * ratioH)
      const xTitleWidth = xAxis?.title !== undefined && xAxis.title.length > 0 ? xAxis.title.length : 0
      const yTitleWidth = yAxis?.title !== undefined && yAxis.title.length > 0 ? yAxis.title.length : 0
      // ratatui LegendPosition::layout also hides the legend when the axis
      // titles leave no vertical room for it.
      const heightMargin = graphHeight - legendHeight - (xTitleWidth > 0 ? 1 : 0) - (yTitleWidth > 0 ? 1 : 0)
      if (innerWidth > 0 && legendWidth <= maxWidth && legendHeight <= maxHeight && heightMargin >= 0) {
        const lx = legendPosition === "top-right" || legendPosition === "bottom-right" ? width - legendWidth : graphLeft
        let ly = legendPosition === "bottom-left" || legendPosition === "bottom-right" ? graphHeight - legendHeight : 0
        // Title-collision rules (ratatui): top legends yield one row to the y
        // title, bottom legends one row to the x title.
        if (legendPosition === "top-right" && legendWidth + yTitleWidth > graphWidth) ly += 1
        else if (legendPosition === "top-left" && yTitleWidth > 0) ly += 1
        else if (legendPosition === "bottom-left" && xTitleWidth + legendWidth > graphWidth) ly -= 1
        else if (legendPosition === "bottom-right" && xTitleWidth > 0) ly -= 1
        // Reset the style (not the glyph) of every cell under the legend, then
        // draw the box and names over it (ratatui set_style + bordered Block).
        for (const cell of cells) {
          if (cell.x >= lx && cell.x < lx + legendWidth && cell.y >= ly && cell.y < ly + legendHeight) {
            cell.fg = undefined
            cell.bg = options.backgroundColor
          }
        }
        drawLegend(cells, lx, ly, legendWidth, legendHeight, named, axisColor)
      }
    }
  }

  return { cells, graphLeft, graphWidth, graphHeight }
}

function drawLegend(
  cells: Cell[],
  x: number,
  y: number,
  legendWidth: number,
  legendHeight: number,
  named: readonly Dataset[],
  borderColor: ColorInput,
): void {
  cells.push({ x, y, char: BOX_TOP_LEFT, fg: borderColor })
  cells.push({
    x: x + legendWidth - 1,
    y,
    char: BOX_TOP_RIGHT,
    fg: borderColor,
  })
  cells.push({
    x,
    y: y + legendHeight - 1,
    char: BOX_BOTTOM_LEFT,
    fg: borderColor,
  })
  cells.push({
    x: x + legendWidth - 1,
    y: y + legendHeight - 1,
    char: BOX_BOTTOM_RIGHT,
    fg: borderColor,
  })
  for (let i = 1; i < legendWidth - 1; i++) {
    cells.push({ x: x + i, y, char: LINE_HORIZONTAL, fg: borderColor })
    cells.push({
      x: x + i,
      y: y + legendHeight - 1,
      char: LINE_HORIZONTAL,
      fg: borderColor,
    })
  }
  for (let row = 1; row < legendHeight - 1; row++) {
    cells.push({ x, y: y + row, char: LINE_VERTICAL, fg: borderColor })
    cells.push({
      x: x + legendWidth - 1,
      y: y + row,
      char: LINE_VERTICAL,
      fg: borderColor,
    })
    const dataset = named[row - 1]!
    paintText(cells, dataset.name!, x + 1, y + row, dataset.color ?? "white")
  }
}
