import type { Cell } from "./cells.js";
import type { ColorInput, GraphType, Marker } from "./types.js";
/** Dataset. */
export interface Dataset {
    /** Legend name; datasets without a name do not appear in the legend. */
    name?: string;
    /** World-space points; non-finite pairs are filtered before layout math. */
    data: ReadonlyArray<readonly [number, number]>;
    /** Marker resolution. Default "braille" (ratatui Canvas default). */
    marker?: Marker;
    /** Connection strategy. Default "scatter" (ratatui Dataset default). */
    graphType?: GraphType;
    /** Series color. Default "white". */
    color?: ColorInput;
}
/** Labels alignment. */
export type LabelsAlignment = "left" | "center" | "right";
/** Axis options. */
export interface AxisOptions {
    /** REQUIRED finite [min, max] when an axis object is provided. */
    bounds?: readonly [number, number];
    /** Tick labels; axis lines render only when labels exist (ratatui v0.30 rule). */
    labels?: readonly string[];
    /** Axis title; requires graph height > 2 and must fit (ratatui rule). */
    title?: string;
    /** Default "left" (ratatui Alignment::Left). On the x axis this only affects the FIRST label. */
    labelsAlignment?: LabelsAlignment;
    /** Axis line/label/title color. Default: the chart color. */
    color?: ColorInput;
}
/** Legend position. */
export type LegendPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left" | "none";
/** Chart layout options. */
export interface ChartLayoutOptions {
    datasets?: readonly Dataset[];
    xAxis?: AxisOptions;
    yAxis?: AxisOptions;
    /** Default "top-right"; auto-hides when the legend exceeds the hidden-legend constraints. */
    legendPosition?: LegendPosition;
    /** [widthRatio, heightRatio] of the graph area. Default [1/4, 1/4] (ratatui parity). */
    hiddenLegendConstraints?: readonly [number, number];
    /** Default axis/label/title/legend-border color. Default "white". */
    color?: ColorInput;
    /** Background painted across the whole widget area. */
    backgroundColor?: ColorInput;
}
/**
 * Validate the bounds contract: when an axis object is provided, its bounds
 * are required and must be a finite pair. This is the one hard error — all
 * other degenerate input renders nothing without throwing.
 */
export declare function validateChartOptions(options: ChartLayoutOptions): void;
interface ChartLayout {
    cells: Cell[];
    graphLeft: number;
    graphWidth: number;
    graphHeight: number;
}
/**
 * Chart layout (port of ratatui `Chart::layout` + `Chart::render` +
 * Canvas data pipeline). Stages: layout -> axis lines/labels -> data ->
 * titles -> legend. Text always paints over data (ratatui order).
 */
export declare function layoutChart(options: ChartLayoutOptions, width: number, height: number): Cell[];
/** Internal variant exposing the computed graph area (used by tests). */
export declare function layoutChartInternal(options: ChartLayoutOptions, width: number, height: number): ChartLayout;
export {};
