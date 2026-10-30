import { Renderable } from "@defai-digital/ax-tui";
import type { OptimizedBuffer, RenderContext, RenderableOptions } from "@defai-digital/ax-tui";
import { type SparklineLayoutOptions } from "./sparkline.js";
import { type GaugeLayoutOptions } from "./gauge.js";
import { type BarChartLayoutOptions } from "./barchart.js";
import { type AxisOptions, type ChartLayoutOptions, type Dataset } from "./chart.js";
import type { ColorInput } from "./types.js";
/** Sparkline options. */
export interface SparklineOptions extends RenderableOptions<SparklineRenderable>, SparklineLayoutOptions {
}
/** Compact sparkline chart renderable. */
export declare class SparklineRenderable extends Renderable {
    private _layout;
    constructor(ctx: RenderContext, options: SparklineOptions);
    get data(): readonly (number | null | undefined)[];
    set data(value: readonly (number | null | undefined)[]);
    get max(): number | undefined;
    set max(value: number | undefined);
    get direction(): "ltr" | "rtl" | undefined;
    set direction(value: "ltr" | "rtl" | undefined);
    get color(): ColorInput | undefined;
    set color(value: ColorInput | undefined);
    get backgroundColor(): ColorInput | undefined;
    set backgroundColor(value: ColorInput | undefined);
    get barColor(): SparklineLayoutOptions["barColor"];
    set barColor(value: SparklineLayoutOptions["barColor"]);
    protected renderSelf(buffer: OptimizedBuffer): void;
}
/** Gauge options. */
export interface GaugeOptions extends RenderableOptions<GaugeRenderable>, GaugeLayoutOptions {
}
/** Horizontal gauge renderable. */
export declare class GaugeRenderable extends Renderable {
    private _layout;
    constructor(ctx: RenderContext, options: GaugeOptions);
    get ratio(): number | undefined;
    set ratio(value: number | undefined);
    get label(): string | null | undefined;
    set label(value: string | null | undefined);
    get color(): ColorInput | undefined;
    set color(value: ColorInput | undefined);
    get labelColor(): GaugeLayoutOptions["labelColor"];
    set labelColor(value: GaugeLayoutOptions["labelColor"]);
    get backgroundColor(): GaugeLayoutOptions["backgroundColor"];
    set backgroundColor(value: GaugeLayoutOptions["backgroundColor"]);
    get unicode(): boolean | undefined;
    set unicode(value: boolean | undefined);
    protected renderSelf(buffer: OptimizedBuffer): void;
}
/** Bar chart options. */
export interface BarChartOptions extends RenderableOptions<BarChartRenderable>, BarChartLayoutOptions {
}
/** Bar-chart renderable. */
export declare class BarChartRenderable extends Renderable {
    private _layout;
    constructor(ctx: RenderContext, options: BarChartOptions);
    get data(): BarChartLayoutOptions["data"];
    set data(value: BarChartLayoutOptions["data"]);
    get barWidth(): number | undefined;
    set barWidth(value: number | undefined);
    get barGap(): number | undefined;
    set barGap(value: number | undefined);
    get max(): number | undefined;
    set max(value: number | undefined);
    get showValues(): boolean | undefined;
    set showValues(value: boolean | undefined);
    get showLabels(): boolean | undefined;
    set showLabels(value: boolean | undefined);
    get color(): ColorInput | undefined;
    set color(value: ColorInput | undefined);
    get backgroundColor(): BarChartLayoutOptions["backgroundColor"];
    set backgroundColor(value: BarChartLayoutOptions["backgroundColor"]);
    protected renderSelf(buffer: OptimizedBuffer): void;
}
/** Chart options. */
export interface ChartOptions extends RenderableOptions<ChartRenderable>, ChartLayoutOptions {
}
/** Cartesian chart renderable with axes, legend, and markers. */
export declare class ChartRenderable extends Renderable {
    private _layout;
    constructor(ctx: RenderContext, options: ChartOptions);
    get datasets(): readonly Dataset[];
    set datasets(value: ChartLayoutOptions["datasets"]);
    get xAxis(): AxisOptions | undefined;
    set xAxis(value: AxisOptions | undefined);
    get yAxis(): AxisOptions | undefined;
    set yAxis(value: AxisOptions | undefined);
    get legendPosition(): ChartLayoutOptions["legendPosition"];
    set legendPosition(value: ChartLayoutOptions["legendPosition"]);
    get hiddenLegendConstraints(): ChartLayoutOptions["hiddenLegendConstraints"];
    set hiddenLegendConstraints(value: ChartLayoutOptions["hiddenLegendConstraints"]);
    get color(): ColorInput | undefined;
    set color(value: ColorInput | undefined);
    get backgroundColor(): ChartLayoutOptions["backgroundColor"];
    set backgroundColor(value: ChartLayoutOptions["backgroundColor"]);
    protected renderSelf(buffer: OptimizedBuffer): void;
}
