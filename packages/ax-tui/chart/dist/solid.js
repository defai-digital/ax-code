/**
 * Registers SolidJS JSX tags for chart widgets (`<chart>`, `<sparkline>`, `<barchart>`, `<gauge>`).
 *
 * Import this module once so those tags resolve at runtime.
 *
 * @module
 */
import { BarChartRenderable, ChartRenderable, GaugeRenderable, SparklineRenderable } from "./renderables.js";
import { extend } from "@defai-digital/ax-tui/solid";
extend({
    sparkline: SparklineRenderable,
    gauge: GaugeRenderable,
    barchart: BarChartRenderable,
    chart: ChartRenderable,
});
