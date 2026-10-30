/**
 * Built-in spinner animation presets.
 *
 * Inlined from the `cli-spinners` package (MIT, Sindre Sorhus) so that
 * `@defai-digital/ax-tui/spinner` has zero runtime dependency on third-party
 * spinner data. Add new presets here as needed.
 */
export interface SpinnerPreset {
    /** Intended time per frame, in milliseconds. */
    readonly interval: number;
    /** Array of frame strings to cycle through. */
    readonly frames: readonly string[];
}
/** Name of a built-in spinner preset. */
export type SpinnerName = "dots" | "dots2" | "dots3" | "dots4" | "dots5" | "dots9" | "dots10" | "dots11" | "line" | "line2" | "pipe" | "simpleDots" | "star" | "star2" | "flip" | "hamburger" | "growVertical" | "growHorizontal" | "balloon" | "balloon2" | "bounce" | "boxBounce" | "boxBounce2" | "triangle" | "arc" | "circle" | "squareCorners" | "circleQuarters" | "circleHalves" | "squish" | "toggle" | "toggle2" | "toggle3" | "toggle4" | "toggle5" | "arrow" | "arrow3" | "bouncingBar" | "bouncingBall" | "aesthetic";
declare const presets: Record<SpinnerName, SpinnerPreset>;
/**
 * Returns the preset for the given spinner name, or `undefined` if not found.
 *
 * The parameter is a plain `string` (not `SpinnerName`) so callers can probe
 * arbitrary names at runtime and receive `undefined` for unknown values,
 * matching the constructor's validation path.
 */
export declare function getSpinnerPreset(name: string): SpinnerPreset | undefined;
/**
 * Returns all available preset names.
 */
export declare function getSpinnerNames(): SpinnerName[];
/**
 * Returns a random spinner preset.
 */
export declare function randomSpinner(): SpinnerPreset;
/** Built-in spinner animation presets keyed by {@link SpinnerName}. */
export default presets;
