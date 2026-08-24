/**
 * Maximum display width across a set of frames, using a per-frame measurer.
 *
 * The renderer measures glyph display width through the native
 * `encodeUnicode` path; summing `frame.length` (UTF-16 code units) would
 * under-count wide/emoji glyphs. Keep this computation in a pure helper so it
 * is unit-testable without loading the native render library.
 */
export function maxFrameDisplayWidth(frames, measure) {
    let max = 0;
    for (const frame of frames) {
        const width = measure(frame);
        if (width > max)
            max = width;
    }
    return max;
}
/**
 * Creates a static color generator that always returns the same color.
 */
export function createStatic(color) {
    return () => color;
}
/**
 * Creates a pulsing color effect that cycles through colors at a given speed.
 *
 * @example
 * ```typescript
 * const colorGen = createPulse(["red", "orange", "yellow"], 0.5);
 * ```
 */
export function createPulse(colors, speed = 1) {
    if (colors.length === 0)
        throw new Error("createPulse: colors array must not be empty");
    const safeSpeed = Math.max(0, speed);
    return (frameIndex) => colors[Math.floor(frameIndex * safeSpeed) % colors.length];
}
/**
 * Creates a wave pattern that moves across characters.
 *
 * @example
 * ```typescript
 * const colorGen = createWave(["#ff0000", "#00ff00", "#0000ff"]);
 * ```
 */
export function createWave(colors) {
    if (colors.length === 0)
        throw new Error("createWave: colors array must not be empty");
    return (frameIndex, charIndex, _totalFrames, totalChars) => {
        if (totalChars <= 0)
            return colors[0];
        const progress = (charIndex + frameIndex) % totalChars;
        return colors[Math.floor((progress / totalChars) * colors.length)] ?? colors[0];
    };
}
/**
 * Creates a rainbow gradient that cycles through the spectrum across characters.
 * Uses HSL-style hue rotation mapped to a discrete color palette.
 */
export function createRainbow() {
    const hueColors = [
        "#ff0000", // red
        "#ff8800", // orange
        "#ffff00", // yellow
        "#00ff00", // green
        "#0088ff", // blue
        "#8800ff", // violet
    ];
    return createWave(hueColors);
}
