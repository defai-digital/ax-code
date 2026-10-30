import { Renderable, parseColor } from "@defai-digital/ax-tui";
import { layoutSparkline } from "./sparkline.js";
import { layoutGauge } from "./gauge.js";
import { layoutBarChart } from "./barchart.js";
import { layoutChart, validateChartOptions } from "./chart.js";
function paintCells(buffer, cells, offsetX, offsetY, defaultFg) {
    for (const cell of cells) {
        buffer.drawText(cell.char, offsetX + cell.x, offsetY + cell.y, parseColor(cell.fg ?? defaultFg), parseColor(cell.bg ?? "transparent"));
    }
}
/** Compact sparkline chart renderable. */
export class SparklineRenderable extends Renderable {
    _layout;
    constructor(ctx, options) {
        super(ctx, options);
        this._layout = {
            data: options.data ?? [],
            max: options.max,
            direction: options.direction,
            color: options.color,
            barColor: options.barColor,
            backgroundColor: options.backgroundColor,
        };
        this.width = options.width ?? "100%";
        this.height = options.height ?? 1;
    }
    get data() {
        return this._layout.data;
    }
    set data(value) {
        this._layout.data = value ?? [];
        this.requestRender();
    }
    get max() {
        return this._layout.max;
    }
    set max(value) {
        this._layout.max = value;
        this.requestRender();
    }
    get direction() {
        return this._layout.direction;
    }
    set direction(value) {
        this._layout.direction = value;
        this.requestRender();
    }
    get color() {
        return this._layout.color;
    }
    set color(value) {
        this._layout.color = value;
        this.requestRender();
    }
    get backgroundColor() {
        return this._layout.backgroundColor;
    }
    set backgroundColor(value) {
        this._layout.backgroundColor = value;
        this.requestRender();
    }
    get barColor() {
        return this._layout.barColor;
    }
    set barColor(value) {
        this._layout.barColor = value;
        this.requestRender();
    }
    renderSelf(buffer) {
        if (!this.visible)
            return;
        // The layout inputs are mutable by reference (see the `data` getter), so a
        // cached frame could outlive the data it was computed from. Recompute on
        // every frame so each painted frame reflects the current state.
        paintCells(buffer, layoutSparkline(this._layout, this.width, this.height), this.x, this.y, "white");
    }
}
/** Horizontal gauge renderable. */
export class GaugeRenderable extends Renderable {
    _layout;
    constructor(ctx, options) {
        super(ctx, options);
        this._layout = {
            ratio: options.ratio,
            label: options.label,
            color: options.color,
            labelColor: options.labelColor,
            backgroundColor: options.backgroundColor,
            unicode: options.unicode,
        };
        this.width = options.width ?? "100%";
        this.height = options.height ?? 1;
    }
    get ratio() {
        return this._layout.ratio;
    }
    set ratio(value) {
        this._layout.ratio = value;
        this.requestRender();
    }
    get label() {
        return this._layout.label;
    }
    set label(value) {
        this._layout.label = value;
        this.requestRender();
    }
    get color() {
        return this._layout.color;
    }
    set color(value) {
        this._layout.color = value;
        this.requestRender();
    }
    get labelColor() {
        return this._layout.labelColor;
    }
    set labelColor(value) {
        this._layout.labelColor = value;
        this.requestRender();
    }
    get backgroundColor() {
        return this._layout.backgroundColor;
    }
    set backgroundColor(value) {
        this._layout.backgroundColor = value;
        this.requestRender();
    }
    get unicode() {
        return this._layout.unicode;
    }
    set unicode(value) {
        this._layout.unicode = value;
        this.requestRender();
    }
    renderSelf(buffer) {
        if (!this.visible)
            return;
        paintCells(buffer, layoutGauge(this._layout, this.width, this.height), this.x, this.y, "white");
    }
}
/** Bar-chart renderable. */
export class BarChartRenderable extends Renderable {
    _layout;
    constructor(ctx, options) {
        super(ctx, options);
        this._layout = {
            data: options.data ?? [],
            barWidth: options.barWidth,
            barGap: options.barGap,
            max: options.max,
            showValues: options.showValues,
            showLabels: options.showLabels,
            color: options.color,
            backgroundColor: options.backgroundColor,
        };
        this.width = options.width ?? "100%";
        this.height = options.height ?? 8;
    }
    get data() {
        return this._layout.data;
    }
    set data(value) {
        this._layout.data = value ?? [];
        this.requestRender();
    }
    get barWidth() {
        return this._layout.barWidth;
    }
    set barWidth(value) {
        this._layout.barWidth = value;
        this.requestRender();
    }
    get barGap() {
        return this._layout.barGap;
    }
    set barGap(value) {
        this._layout.barGap = value;
        this.requestRender();
    }
    get max() {
        return this._layout.max;
    }
    set max(value) {
        this._layout.max = value;
        this.requestRender();
    }
    get showValues() {
        return this._layout.showValues;
    }
    set showValues(value) {
        this._layout.showValues = value;
        this.requestRender();
    }
    get showLabels() {
        return this._layout.showLabels;
    }
    set showLabels(value) {
        this._layout.showLabels = value;
        this.requestRender();
    }
    get color() {
        return this._layout.color;
    }
    set color(value) {
        this._layout.color = value;
        this.requestRender();
    }
    get backgroundColor() {
        return this._layout.backgroundColor;
    }
    set backgroundColor(value) {
        this._layout.backgroundColor = value;
        this.requestRender();
    }
    renderSelf(buffer) {
        if (!this.visible)
            return;
        // See SparklineRenderable: inputs are mutable by reference, so recompute on
        // every frame instead of caching a potentially stale frame.
        paintCells(buffer, layoutBarChart(this._layout, this.width, this.height), this.x, this.y, "white");
    }
}
/** Cartesian chart renderable with axes, legend, and markers. */
export class ChartRenderable extends Renderable {
    _layout;
    constructor(ctx, options) {
        super(ctx, options);
        validateChartOptions(options);
        this._layout = {
            datasets: options.datasets ?? [],
            xAxis: options.xAxis,
            yAxis: options.yAxis,
            legendPosition: options.legendPosition,
            hiddenLegendConstraints: options.hiddenLegendConstraints,
            color: options.color,
            backgroundColor: options.backgroundColor,
        };
        this.width = options.width ?? "100%";
        this.height = options.height ?? 10;
    }
    get datasets() {
        return this._layout.datasets ?? [];
    }
    set datasets(value) {
        this._layout.datasets = value ?? [];
        this.requestRender();
    }
    get xAxis() {
        return this._layout.xAxis;
    }
    set xAxis(value) {
        validateChartOptions({ xAxis: value });
        this._layout.xAxis = value;
        this.requestRender();
    }
    get yAxis() {
        return this._layout.yAxis;
    }
    set yAxis(value) {
        validateChartOptions({ yAxis: value });
        this._layout.yAxis = value;
        this.requestRender();
    }
    get legendPosition() {
        return this._layout.legendPosition;
    }
    set legendPosition(value) {
        this._layout.legendPosition = value;
        this.requestRender();
    }
    get hiddenLegendConstraints() {
        return this._layout.hiddenLegendConstraints;
    }
    set hiddenLegendConstraints(value) {
        this._layout.hiddenLegendConstraints = value;
        this.requestRender();
    }
    get color() {
        return this._layout.color;
    }
    set color(value) {
        this._layout.color = value;
        this.requestRender();
    }
    get backgroundColor() {
        return this._layout.backgroundColor;
    }
    set backgroundColor(value) {
        this._layout.backgroundColor = value;
        this.requestRender();
    }
    renderSelf(buffer) {
        if (!this.visible)
            return;
        // See SparklineRenderable: datasets are mutable by reference, so recompute
        // on every frame instead of caching a potentially stale frame.
        paintCells(buffer, layoutChart(this._layout, this.width, this.height), this.x, this.y, "white");
    }
}
