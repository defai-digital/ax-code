/**
 * Shared chart types.
 *
 * Pure modules must not import the `@defai-digital/ax-tui` runtime; type-only imports are
 * erased at build time and keep the layout functions unit-testable without
 * native libraries.
 */
export type { ColorInput } from "@defai-digital/ax-tui";
/**
 * Marker resolution strategy for Chart datasets.
 * Ported subset of ratatui `symbols::Marker`: Dot (1x1 "•"), Block (1x1 "█"
 * with fg+bg), Braille (2x4 dots per cell). HalfBlock/Quadrant/Sextant/
 * Octant are deferred to a future version.
 */
export type Marker = "dot" | "block" | "braille";
/**
 * How consecutive dataset points are connected.
 * Ported subset of ratatui `GraphType` (Area/fill_to_y deferred).
 */
export type GraphType = "line" | "scatter" | "bar";
