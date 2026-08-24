import { Renderable } from "@ax-code/tui";
import type { ColorInput, LayoutOptions, OptimizedBuffer, RenderContext, RenderableOptions } from "@ax-code/tui";
import presets, { type SpinnerName } from "./presets.js";
import { type ColorGenerator } from "./utils.js";
export type { ColorGenerator } from "./utils.js";
export { createPulse, createWave, createStatic, createRainbow, maxFrameDisplayWidth } from "./utils.js";
export { type SpinnerName, type SpinnerPreset, getSpinnerPreset, getSpinnerNames, randomSpinner } from "./presets.js";
export { presets };
export interface SpinnerOptions extends Omit<RenderableOptions<SpinnerRenderable>, "width" | "height" | "buffered" | "live" | keyof LayoutOptions> {
    /** Use a named preset (e.g. "dots", "line", "arc"). Overrides `frames` and `interval`. */
    name?: SpinnerName;
    /** Custom frame strings. Used when `name` is not set. */
    frames?: string[];
    /** Animation interval in milliseconds. Used when `name` is not set. */
    interval?: number;
    /** Whether to start animating immediately. Default: `true`. */
    autoplay?: boolean;
    /** Background color for the spinner area. */
    backgroundColor?: ColorInput;
    /** Solid color or per-character color generator. */
    color?: ColorInput | ColorGenerator;
}
export declare class SpinnerRenderable extends Renderable {
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
        frames: ("⠋" | "⠙" | "⠹" | "⠸" | "⠼" | "⠴" | "⠦" | "⠧" | "⠇" | "⠏")[];
        interval: 80;
        autoplay: true;
        backgroundColor: string;
        color: string;
    };
    constructor(ctx: RenderContext, options: SpinnerOptions);
    private _encodeFrames;
    private _freeFrames;
    private _computeWidth;
    private _replaceFrames;
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
    /** Whether the spinner animation is currently running. */
    get running(): boolean;
    /** Current frame index in the animation cycle. */
    get currentFrameIndex(): number;
    start(): void;
    stop(): void;
    /** Reset the animation to the first frame. */
    reset(): void;
    protected renderSelf(buffer: OptimizedBuffer): void;
    protected destroySelf(): void;
}
