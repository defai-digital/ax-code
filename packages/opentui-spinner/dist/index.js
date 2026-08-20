import { Renderable, parseColor, resolveRenderLib } from "@ax-code/opentui-core";
import presets, { getSpinnerPreset } from "./presets.js";
import { maxFrameDisplayWidth } from "./utils.js";
export { createPulse, createWave, createStatic, createRainbow, maxFrameDisplayWidth } from "./utils.js";
export { getSpinnerPreset, getSpinnerNames, randomSpinner } from "./presets.js";
// Re-export preset map for advanced use (e.g. custom iteration)
export { presets };
const DEFAULT_FRAMES = presets.dots.frames;
const DEFAULT_INTERVAL = presets.dots.interval;
export class SpinnerRenderable extends Renderable {
    _name;
    _frames;
    _interval;
    _autoplay;
    _backgroundColor;
    _color;
    _currentFrameIndex = 0;
    _encodedFrames = {};
    _lib = resolveRenderLib();
    _intervalId = null;
    _defaultOptions = {
        name: "dots",
        frames: [...DEFAULT_FRAMES],
        interval: DEFAULT_INTERVAL,
        autoplay: true,
        backgroundColor: "transparent",
        color: "white",
    };
    constructor(ctx, options) {
        super(ctx, options);
        if (options.name) {
            const preset = getSpinnerPreset(options.name);
            if (!preset) {
                throw new Error(`Unknown spinner preset: "${options.name}"`);
            }
            this._name = options.name;
            this._frames = [...preset.frames];
            this._interval = preset.interval;
        }
        else {
            this._name = undefined;
            this._frames = options.frames?.length ? [...options.frames] : [...DEFAULT_FRAMES];
            this._interval = options.interval ?? DEFAULT_INTERVAL;
        }
        if (this._interval <= 0) {
            throw new Error(`Spinner interval must be positive, got ${this._interval}`);
        }
        this._autoplay = options.autoplay ?? true;
        this._backgroundColor = options.backgroundColor ?? "transparent";
        this._color = options.color ?? "white";
        this._encodeFrames();
        this.width = this._computeWidth();
        this.height = 1;
        if (this._autoplay)
            this.start();
    }
    // --- Frame encoding (native unicode width calculation) ---
    _encodeFrames() {
        for (const frame of this._frames) {
            const encoded = this._lib.encodeUnicode(frame, this.ctx.widthMethod);
            if (encoded) {
                this._encodedFrames[frame] = encoded;
            }
        }
    }
    _freeFrames() {
        for (const frame in this._encodedFrames) {
            const encoded = this._encodedFrames[frame];
            if (encoded)
                this._lib.freeUnicode(encoded);
        }
        this._encodedFrames = {};
    }
    _computeWidth() {
        return maxFrameDisplayWidth(this._frames, (frame) => {
            const encoded = this._encodedFrames[frame];
            if (!encoded)
                return 0;
            let width = 0;
            for (const glyph of encoded.data)
                width += glyph.width;
            return width;
        });
    }
    // --- Public API ---
    get interval() {
        return this._interval;
    }
    set interval(value) {
        if (value <= 0)
            return;
        const wasRunning = this._intervalId !== null;
        this.stop();
        this._interval = value;
        if (wasRunning)
            this.start();
    }
    get name() {
        return this._name;
    }
    set name(value) {
        if (value !== undefined) {
            const preset = getSpinnerPreset(value);
            if (!preset)
                return;
            this._freeFrames();
            this._name = value;
            this._frames = [...preset.frames];
            this._interval = preset.interval;
        }
        else {
            this._freeFrames();
            this._name = undefined;
            this._frames = [...DEFAULT_FRAMES];
            this._interval = DEFAULT_INTERVAL;
        }
        this.width = this._computeWidth();
        this._encodeFrames();
        this.requestRender();
    }
    get frames() {
        return this._frames;
    }
    set frames(value) {
        this._freeFrames();
        this._frames = value.length === 0 ? [...DEFAULT_FRAMES] : [...value];
        this._encodeFrames();
        this.width = this._computeWidth();
        this.requestRender();
    }
    get color() {
        return this._color;
    }
    set color(value) {
        this._color = value;
        this.requestRender();
    }
    get backgroundColor() {
        return this._backgroundColor;
    }
    set backgroundColor(value) {
        this._backgroundColor = value;
        this.requestRender();
    }
    /** Whether the spinner animation is currently running. */
    get running() {
        return this._intervalId !== null;
    }
    /** Current frame index in the animation cycle. */
    get currentFrameIndex() {
        return this._currentFrameIndex;
    }
    start() {
        if (this._intervalId)
            return;
        this._intervalId = setInterval(() => {
            this._currentFrameIndex = (this._currentFrameIndex + 1) % this._frames.length;
            this.requestRender();
        }, this._interval);
    }
    stop() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }
    /** Reset the animation to the first frame. */
    reset() {
        this._currentFrameIndex = 0;
        this.requestRender();
    }
    // --- Rendering ---
    renderSelf(buffer) {
        if (!this.visible)
            return;
        const frame = this._frames[this._currentFrameIndex];
        if (!frame)
            return;
        const encoded = this._encodedFrames[frame];
        if (!encoded)
            return;
        let x = this.x;
        for (let i = 0; i < encoded.data.length; i++) {
            const glyph = encoded.data[i];
            const resolvedColor = typeof this._color === "function"
                ? this._color(this._currentFrameIndex, i, this._frames.length, encoded.data.length)
                : this._color;
            buffer.drawChar(glyph.char, x, this.y, parseColor(resolvedColor), parseColor(this._backgroundColor));
            x += glyph.width;
        }
    }
    destroySelf() {
        this.stop();
        this._freeFrames();
        super.destroySelf();
    }
}
