import { ColorInput, LayoutOptions, OptimizedBuffer, RenderContext, Renderable, RenderableOptions } from "@opentui/core";
import spinners from "cli-spinners";

//#region src/utils.d.ts

/**
 * Function that generates a color for a specific character at a specific frame
 * @param frameIndex - Current frame index (0 to totalFrames-1)
 * @param charIndex - Current character index (0 to totalChars-1)
 * @param totalFrames - Total number of frames in the animation
 * @param totalChars - Total number of characters in the current frame
 * @returns Color for this specific character at this specific frame
 */
type ColorGenerator = (frameIndex: number, charIndex: number, totalFrames: number, totalChars: number) => ColorInput;
/**
 * Creates a pulsing color effect that cycles through colors
 * @example
 * ```typescript
 * const colorGen = createPulse(["red", "orange", "yellow"], 0.5);
 * ```
 */
declare function createPulse(colors: ColorInput[], speed?: number): ColorGenerator;
/**
 * Creates a wave pattern that moves across characters
 * @example
 * ```typescript
 * const colorGen = createWave(["#ff0000", "#00ff00", "#0000ff"]);
 * ```
 */
declare function createWave(colors: ColorInput[]): ColorGenerator;
//#endregion
//#region src/index.d.ts
type SpinnerName = keyof typeof spinners;
interface SpinnerOptions extends Omit<RenderableOptions<SpinnerRenderable>, "width" | "height" | "buffered" | "live" | keyof LayoutOptions> {
  name?: SpinnerName;
  frames?: string[];
  interval?: number;
  autoplay?: boolean;
  backgroundColor?: ColorInput;
  color?: ColorInput | ColorGenerator;
}
declare class SpinnerRenderable extends Renderable {
  private _name;
  private _frames;
  private _interval;
  private _autoplay;
  private _backgroundColor;
  private _color;
  private _currentFrameIndex;
  private _encodedFrames;
  private _lib;
  private _intervalId;
  protected _defaultOptions: {
    name: "dots";
    frames: string[];
    interval: number;
    autoplay: true;
    backgroundColor: string;
    color: string;
  };
  constructor(ctx: RenderContext, options: SpinnerOptions);
  private _encodeFrames;
  private _freeFrames;
  get interval(): number;
  set interval(value: number);
  get name(): SpinnerName | undefined;
  set name(value: SpinnerName | undefined);
  get frames(): string[];
  set frames(value: string[]);
  get color(): ColorInput | ColorGenerator;
  set color(value: ColorInput | ColorGenerator);
  get backgroundColor(): ColorInput;
  set backgroundColor(value: ColorInput);
  start(): void;
  stop(): void;
  protected renderSelf(buffer: OptimizedBuffer): void;
  protected destroySelf(): void;
}
//#endregion
export { createWave as a, createPulse as i, SpinnerRenderable as n, ColorGenerator as r, SpinnerOptions as t };