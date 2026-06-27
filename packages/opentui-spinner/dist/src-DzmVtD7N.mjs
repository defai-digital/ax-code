import { Renderable, parseColor, resolveRenderLib } from "@ax-code/opentui-core";

// --- Built-in spinner presets (inlined from cli-spinners, MIT, Sindre Sorhus) ---

const presets = {
  dots: { interval: 80, frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] },
  dots2: { interval: 80, frames: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"] },
  dots3: { interval: 80, frames: ["⠋", "⠙", "⠚", "⠞", "⠖", "⠦", "⠴", "⠲", "⠳", "⠓"] },
  dots4: { interval: 80, frames: ["⠄", "⠆", "⠇", "⠋", "⠙", "⠸", "⠰", "⠠", "⠰", "⠸", "⠙", "⠋", "⠇", "⠆"] },
  dots5: { interval: 80, frames: ["⠋", "⠙", "⠚", "⠒", "⠂", "⠂", "⠒", "⠲", "⠴", "⠦", "⠖", "⠒", "⠐", "⠐", "⠒", "⠓", "⠋"] },
  dots9: { interval: 80, frames: ["⢹", "⢺", "⢼", "⣸", "⣇", "⡧", "⡗", "⡏"] },
  dots10: { interval: 80, frames: ["⢄", "⢂", "⢁", "⡁", "⡈", "⡐", "⡠"] },
  dots11: { interval: 100, frames: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"] },
  line: { interval: 130, frames: ["-", "\\", "|", "/"] },
  line2: { interval: 100, frames: ["⠂", "-", "–", "—", "–", "-"] },
  pipe: { interval: 100, frames: ["┤", "┘", "┴", "└", "├", "┌", "┬", "┐"] },
  simpleDots: { interval: 400, frames: [".  ", ".. ", "...", "   "] },
  star: { interval: 70, frames: ["✶", "✸", "✹", "✺", "✹", "✷"] },
  star2: { interval: 80, frames: ["+", "x", "*"] },
  flip: { interval: 70, frames: ["_", "_", "_", "-", "`", "`", "'", "´", "-", "_", "_", "_"] },
  hamburger: { interval: 100, frames: ["☱", "☲", "☴"] },
  growVertical: { interval: 120, frames: ["▁", "▃", "▄", "▅", "▆", "▇", "▆", "▅", "▄", "▃"] },
  growHorizontal: { interval: 120, frames: ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "▊", "▋", "▌", "▍", "▎"] },
  balloon: { interval: 140, frames: [" ", ".", "o", "O", "@", "*", " "] },
  balloon2: { interval: 120, frames: [".", "o", "O", "°", "O", "o", "."] },
  bounce: { interval: 120, frames: ["⠁", "⠂", "⠄", "⠂"] },
  boxBounce: { interval: 120, frames: ["▖", "▘", "▝", "▗"] },
  boxBounce2: { interval: 100, frames: ["▌", "▀", "▐", "▄"] },
  triangle: { interval: 50, frames: ["◢", "◣", "◤", "◥"] },
  arc: { interval: 100, frames: ["◜", "◠", "◝", "◞", "◡", "◟"] },
  circle: { interval: 120, frames: ["◡", "⊙", "◠"] },
  squareCorners: { interval: 180, frames: ["◰", "◳", "◲", "◱"] },
  circleQuarters: { interval: 120, frames: ["◴", "◷", "◶", "◵"] },
  circleHalves: { interval: 50, frames: ["◐", "◓", "◑", "◒"] },
  squish: { interval: 100, frames: ["╫", "╪"] },
  toggle: { interval: 250, frames: ["⊶", "⊷"] },
  toggle2: { interval: 80, frames: ["▫", "▪"] },
  toggle3: { interval: 120, frames: ["□", "■"] },
  toggle4: { interval: 100, frames: ["■", "□", "▪", "▫"] },
  toggle5: { interval: 100, frames: ["▮", "▯"] },
  arrow: { interval: 100, frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"] },
  arrow3: { interval: 120, frames: ["▹▹▹▹▹", "▸▹▹▹▹", "▹▸▹▹▹", "▹▹▸▹▹", "▹▹▹▸▹", "▹▹▹▹▸"] },
  bouncingBar: { interval: 80, frames: ["[    ]", "[=   ]", "[==  ]", "[=== ]", "[====]", "[ ===]", "[  ==]", "[   =]", "[    ]", "[   =]", "[  ==]", "[ ===]", "[====]", "[=== ]", "[==  ]", "[=   ]"] },
  bouncingBall: { interval: 80, frames: ["( ●    )", "(  ●   )", "(   ●  )", "(    ● )", "(     ●)", "(    ● )", "(   ●  )", "(  ●   )", "( ●    )", "(●     )"] },
  aesthetic: { interval: 80, frames: ["▰▱▱▱▱▱▱", "▰▰▱▱▱▱▱", "▰▰▰▱▱▱▱", "▰▰▰▰▱▱▱", "▰▰▰▰▰▱▱", "▰▰▰▰▰▰▱", "▰▰▰▰▰▰▰", "▰▱▱▱▱▱▱"] },
};

function getSpinnerPreset(name) { return presets[name]; }
function getSpinnerNames() { return Object.keys(presets); }
function randomSpinner() {
  const names = getSpinnerNames();
  return presets[names[Math.floor(Math.random() * names.length)]];
}

// --- Color generator utilities ---

function createStatic(color) { return () => color; }

function createPulse(colors, speed = 1) {
  if (colors.length === 0) throw new Error("createPulse: colors array must not be empty");
  const safeSpeed = Math.max(0, speed);
  return (frameIndex) => colors[Math.floor(frameIndex * safeSpeed) % colors.length];
}

function createWave(colors) {
  if (colors.length === 0) throw new Error("createWave: colors array must not be empty");
  return (frameIndex, charIndex, _totalFrames, totalChars) => {
    if (totalChars <= 0) return colors[0];
    const progress = (charIndex + frameIndex) % totalChars;
    return colors[Math.floor((progress / totalChars) * colors.length)] ?? colors[0];
  };
}

function createRainbow() {
  return createWave(["#ff0000", "#ff8800", "#ffff00", "#00ff00", "#0088ff", "#8800ff"]);
}

// --- SpinnerRenderable ---

const DEFAULT_FRAMES = presets.dots.frames;
const DEFAULT_INTERVAL = presets.dots.interval;

class SpinnerRenderable extends Renderable {
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
      if (!preset) throw new Error(`Unknown spinner preset: "${options.name}"`);
      this._name = options.name;
      this._frames = [...preset.frames];
      this._interval = preset.interval;
    } else {
      this._name = undefined;
      this._frames = options.frames?.length ? [...options.frames] : [...DEFAULT_FRAMES];
      this._interval = options.interval ?? DEFAULT_INTERVAL;
    }

    if (this._interval <= 0) throw new Error(`Spinner interval must be positive, got ${this._interval}`);

    this._autoplay = options.autoplay ?? true;
    this._backgroundColor = options.backgroundColor ?? "transparent";
    this._color = options.color ?? "white";
    this.width = this._computeWidth();
    this.height = 1;
    this._encodeFrames();
    if (this._autoplay) this.start();
  }

  _encodeFrames() {
    for (const frame of this._frames) {
      const encoded = this._lib.encodeUnicode(frame, this.ctx.widthMethod);
      if (encoded) this._encodedFrames[frame] = encoded;
    }
  }

  _freeFrames() {
    for (const frame in this._encodedFrames) {
      const encoded = this._encodedFrames[frame];
      if (encoded) this._lib.freeUnicode(encoded);
    }
    this._encodedFrames = {};
  }

  _computeWidth() {
    let max = 0;
    for (const frame of this._frames) {
      if (frame.length > max) max = frame.length;
    }
    return max;
  }

  get interval() { return this._interval; }
  set interval(value) {
    if (value <= 0) return;
    const wasRunning = this._intervalId !== null;
    this.stop();
    this._interval = value;
    if (wasRunning) this.start();
  }

  get name() { return this._name; }
  set name(value) {
    if (value !== undefined) {
      const preset = getSpinnerPreset(value);
      if (!preset) return;
      this._freeFrames();
      this._name = value;
      this._frames = [...preset.frames];
      this._interval = preset.interval;
    } else {
      this._freeFrames();
      this._name = undefined;
      this._frames = [...DEFAULT_FRAMES];
      this._interval = DEFAULT_INTERVAL;
    }
    this.width = this._computeWidth();
    this._encodeFrames();
    this.requestRender();
  }

  get frames() { return this._frames; }
  set frames(value) {
    this._freeFrames();
    this._frames = value.length === 0 ? [...DEFAULT_FRAMES] : [...value];
    this._encodeFrames();
    this.width = this._computeWidth();
    this.requestRender();
  }

  get color() { return this._color; }
  set color(value) { this._color = value; this.requestRender(); }

  get backgroundColor() { return this._backgroundColor; }
  set backgroundColor(value) { this._backgroundColor = value; this.requestRender(); }

  get running() { return this._intervalId !== null; }
  get currentFrameIndex() { return this._currentFrameIndex; }

  start() {
    if (this._intervalId) return;
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

  reset() {
    this._currentFrameIndex = 0;
    this.requestRender();
  }

  renderSelf(buffer) {
    if (!this.visible) return;
    const frame = this._frames[this._currentFrameIndex];
    if (!frame) return;
    const encoded = this._encodedFrames[frame];
    if (!encoded) return;
    let x = this.x;
    for (let i = 0; i < encoded.data.length; i++) {
      const glyph = encoded.data[i];
      const resolvedColor =
        typeof this._color === "function"
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

export {
  SpinnerRenderable,
  presets,
  getSpinnerPreset,
  getSpinnerNames,
  randomSpinner,
  createStatic,
  createPulse,
  createWave,
  createRainbow,
};
