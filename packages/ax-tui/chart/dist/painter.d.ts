import type { Grid, GridResolution } from "./grid.js";
/** World-space axis bounds: `[min, max]` per axis (y grows upward). */
export interface Bounds {
    readonly x: readonly [number, number];
    readonly y: readonly [number, number];
}
/** A point in grid pixel space (origin top-left). */
export interface PixelPoint {
    readonly px: number;
    readonly py: number;
}
/**
 * World-to-pixel mapping (faithful port of ratatui `Painter::get_point`).
 *
 * The world origin is bottom-left (mathematical coordinates); the pixel
 * origin is top-left. Returns null for non-finite input, points outside the
 * bounds, and degenerate/reversed bounds (min >= max) — ratatui draws
 * nothing in those cases and never throws.
 */
export declare function getPoint(wx: number, wy: number, bounds: Bounds, resolution: GridResolution): PixelPoint | null;
/**
 * Cohen-Sutherland clipping of a world-space segment against the bounds
 * (ratatui clips chart lines with the `line_clipping` crate before
 * projecting). Returns the clipped segment, or null when fully outside or
 * when any coordinate is non-finite.
 */
export declare function clipLine(x1: number, y1: number, x2: number, y2: number, bounds: Bounds): [number, number, number, number] | null;
/**
 * Integer Bresenham over pixel space (port of ratatui `for_each_line_point`;
 * the all-octant error-doubling variant produces the same rasterization).
 * Chart line interpolation projects the clipped endpoints first and then
 * rasterizes — never float-step between data points. Invalid or unsafe integer
 * coordinates are ignored so an unreachable endpoint cannot trap the loop.
 */
export declare function forEachLinePoint(x0: number, y0: number, x1: number, y1: number, paint: (px: number, py: number) => void): void;
/** Clip, project, and rasterize one world-space segment onto a grid. */
export declare function strokeSegment(ax: number, ay: number, bx: number, by: number, bounds: Bounds, grid: Grid, paint: (px: number, py: number) => void): void;
