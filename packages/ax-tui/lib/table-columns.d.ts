/**
 * Internal TextTable column-width fitting.
 *
 * This module is intentionally NOT re-exported from `lib/index.ts`: it stays
 * an internal detail so the public package surface is unchanged. The fitting
 * strategies are pure so they can be unit-tested without constructing a
 * renderable.
 *
 * @module
 */
/**
 * Normalize a column width to a positive integer.
 *
 * Non-finite widths (`NaN`, `±Infinity`) resolve to `1` instead of poisoning
 * every downstream total with `NaN`.
 */
export declare function normalizeColumnWidth(width: number): number;
/** Sum a list of column widths. */
export declare function sumWidths(widths: readonly number[]): number;
/** Allocate per-column shrink amounts weighted by shrinkable slack. */
export declare function allocateShrinkByWeight(shrinkable: number[], targetShrink: number, mode: "linear" | "sqrt"): number[];
/**
 * Proportional fitting: shrink columns toward their preferred minimum
 * (content width capped at `minWidth + 1`), distributing the reduction by
 * exact proportional share with largest-remainder rounding.
 */
export declare function fitColumnWidthsProportional(widths: number[], targetContentWidth: number, minWidth: number, columnMinWidths?: readonly number[]): number[];
/**
 * Balanced fitting: even out columns toward a shared width before shrinking
 * the residual by square-root-weighted allocation.
 */
export declare function fitColumnWidthsBalanced(widths: number[], targetContentWidth: number, minWidth: number, columnMinWidths?: readonly number[]): number[];
