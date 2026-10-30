/**
 * Internal numeric bound helpers.
 *
 * This module is intentionally NOT re-exported from `lib/index.ts`: it stays
 * an internal detail of the renderer so the public package surface is
 * unchanged.
 *
 * @module
 */
/**
 * Clamp `value` into the closed interval `[min, max]`.
 *
 * Boundary hardening over the raw `Math.max(min, Math.min(max, value))`
 * pattern used across renderables:
 * - `NaN` resolves to `min` instead of poisoning layout, scroll, and
 *   opacity state with `NaN`;
 * - infinities saturate exactly like the raw pattern (`+Infinity → max`,
 *   `-Infinity → min`), so overflow keeps its direction;
 * - a degenerate range (`max < min`) resolves to `min`, matching the
 *   `Math.max(min, ...)` form's behavior for finite inputs.
 */
export declare function clamp(value: number, min: number, max: number): number;
