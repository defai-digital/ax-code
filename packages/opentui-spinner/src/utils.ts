import type { ColorInput } from "@ax-code/opentui-core"

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
export type ColorGenerator = (
  frameIndex: number,
  charIndex: number,
  totalFrames: number,
  totalChars: number,
) => ColorInput

/**
 * Creates a static color generator that always returns the same color.
 */
export function createStatic(color: ColorInput): ColorGenerator {
  return () => color
}

/**
 * Creates a pulsing color effect that cycles through colors at a given speed.
 *
 * @example
 * ```typescript
 * const colorGen = createPulse(["red", "orange", "yellow"], 0.5);
 * ```
 */
export function createPulse(colors: ColorInput[], speed: number = 1): ColorGenerator {
  if (colors.length === 0) throw new Error("createPulse: colors array must not be empty")
  const safeSpeed = Math.max(0, speed)
  return (frameIndex: number) => colors[Math.floor(frameIndex * safeSpeed) % colors.length]!
}

/**
 * Creates a wave pattern that moves across characters.
 *
 * @example
 * ```typescript
 * const colorGen = createWave(["#ff0000", "#00ff00", "#0000ff"]);
 * ```
 */
export function createWave(colors: ColorInput[]): ColorGenerator {
  if (colors.length === 0) throw new Error("createWave: colors array must not be empty")
  return (frameIndex: number, charIndex: number, _totalFrames: number, totalChars: number) => {
    if (totalChars <= 0) return colors[0]!
    const progress = (charIndex + frameIndex) % totalChars
    return colors[Math.floor((progress / totalChars) * colors.length)] ?? colors[0]!
  }
}

/**
 * Creates a rainbow gradient that cycles through the spectrum across characters.
 * Uses HSL-style hue rotation mapped to a discrete color palette.
 */
export function createRainbow(): ColorGenerator {
  const hueColors = [
    "#ff0000", // red
    "#ff8800", // orange
    "#ffff00", // yellow
    "#00ff00", // green
    "#0088ff", // blue
    "#8800ff", // violet
  ]
  return createWave(hueColors)
}
