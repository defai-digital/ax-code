import type { ColorInput } from "@ax-code/opentui-core";
/**
 * Function that generates a color for a specific character at a specific frame.
 * Used by the spinner to apply per-character, per-frame color effects.
 *
 * @param frameIndex - Current frame index (0 to totalFrames-1)
 * @param charIndex - Current character index (0 to totalChars-1)
 * @param totalFrames - Total number of frames in the animation
 * @param totalChars - Total number of characters in the current frame
 * @returns Color for this specific character at this specific frame
 */
export type ColorGenerator = (frameIndex: number, charIndex: number, totalFrames: number, totalChars: number) => ColorInput;
/**
 * Maximum display width across a set of frames, using a per-frame measurer.
 *
 * The renderer measures glyph display width through the native
 * `encodeUnicode` path; summing `frame.length` (UTF-16 code units) would
 * under-count wide/emoji glyphs. Keep this computation in a pure helper so it
 * is unit-testable without loading the native render library.
 */
export declare function maxFrameDisplayWidth(frames: readonly string[], measure: (frame: string) => number): number;
/**
 * Creates a static color generator that always returns the same color.
 */
export declare function createStatic(color: ColorInput): ColorGenerator;
/**
 * Creates a pulsing color effect that cycles through colors at a given speed.
 *
 * @example
 * ```typescript
 * const colorGen = createPulse(["red", "orange", "yellow"], 0.5);
 * ```
 */
export declare function createPulse(colors: ColorInput[], speed?: number): ColorGenerator;
/**
 * Creates a wave pattern that moves across characters.
 *
 * @example
 * ```typescript
 * const colorGen = createWave(["#ff0000", "#00ff00", "#0000ff"]);
 * ```
 */
export declare function createWave(colors: ColorInput[]): ColorGenerator;
/**
 * Creates a rainbow gradient that cycles through the spectrum across characters.
 * Uses HSL-style hue rotation mapped to a discrete color palette.
 */
export declare function createRainbow(): ColorGenerator;
