import {
  BoxRenderable,
  CliRenderEvents,
  CliRenderer,
  CodeRenderable,
  ConsolePosition,
  EditBuffer,
  EditBufferRenderable,
  EditBufferRenderableEvents,
  EditorView,
  MouseButton,
  MouseEvent,
  NativeSpanFeed,
  RendererControlState,
  RootTextNodeRenderable,
  TerminalConsole,
  TextBufferRenderable,
  TextBufferView,
  TextNodeRenderable,
  TextRenderable,
  buildKeyBindingsMap,
  buildKittyKeyboardFlags,
  capture,
  createCliRenderer,
  defaultKeyAliases,
  getKeyBindingAction,
  getObjectsInViewport,
  isEditBufferRenderable,
  isTextNodeRenderable,
  mergeKeyAliases,
  mergeKeyBindings
} from "./index-NLS65IEM.js";
import {
  ASCIIFontSelectionHelper,
  ATTRIBUTE_BASE_BITS,
  ATTRIBUTE_BASE_MASK,
  BaseRenderable,
  BorderCharArrays,
  BorderChars,
  DEFAULT_BACKGROUND_RGB,
  DEFAULT_FOREGROUND_RGB,
  DataPathsManager,
  DebugOverlayCorner,
  ExtmarksController,
  InternalKeyHandler,
  KeyEvent,
  KeyHandler,
  LayoutEvents,
  LinearScrollAccel,
  LogLevel,
  MacOSScrollAccel,
  MouseParser,
  OptimizedBuffer,
  PasteEvent,
  RGBA,
  Renderable,
  RenderableEvents,
  RootRenderable,
  Selection,
  StdinParser,
  StyledText,
  SyntaxStyle,
  SystemClock,
  TargetChannel,
  TerminalPalette,
  TextAttributes,
  TextBuffer,
  TreeSitterClient,
  addDefaultParsers,
  ansi256IndexToRgb,
  attributesWithLink,
  basenameToFiletype,
  bg,
  bgBlack,
  bgBlue,
  bgCyan,
  bgGreen,
  bgMagenta,
  bgRed,
  bgWhite,
  bgYellow,
  black,
  blink,
  blue,
  bold,
  borderCharsToArray,
  brightBlack,
  brightBlue,
  brightCyan,
  brightGreen,
  brightMagenta,
  brightRed,
  brightWhite,
  brightYellow,
  buildTerminalPaletteSignature,
  clamp,
  clearEnvCache,
  convertGlobalToLocalSelection,
  convertThemeToStyles,
  coordinateToCharacterIndex,
  createExtmarksController,
  createTerminalPalette,
  createTextAttributes,
  cyan,
  decodePasteBytes,
  delegate,
  destroyTreeSitterClient,
  detectLinks,
  dim,
  env,
  envRegistry,
  extToFiletype,
  extensionToFiletype,
  fg,
  fonts,
  generateEnvColored,
  generateEnvMarkdown,
  getBaseAttributes,
  getBorderFromSides,
  getBorderSides,
  getCharacterPositions,
  getDataPaths,
  getLinkId,
  getTreeSitterClient,
  green,
  h,
  hastToStyledText,
  hexToRgb,
  hsvToRgb,
  infoStringToFiletype,
  instantiate,
  isRenderable,
  isStyledText,
  isVNode,
  isValidBorderStyle,
  italic,
  link,
  magenta,
  maybeMakeRenderable,
  measureText,
  nonAlphanumericKeys,
  normalizeColorValue,
  normalizeIndexedColorIndex,
  normalizeTerminalPalette,
  parseAlign,
  parseAlignItems,
  parseBorderStyle,
  parseBoxSizing,
  parseColor,
  parseDimension,
  parseDirection,
  parseDisplay,
  parseEdge,
  parseFlexDirection,
  parseGutter,
  parseJustify,
  parseKeypress,
  parseLogLevel,
  parseMeasureMode,
  parseOverflow,
  parsePositionType,
  parseUnit,
  parseWrap,
  pathToFiletype,
  red,
  registerEnvVar,
  renderFontToFrameBuffer,
  resolveRenderLib,
  reverse,
  rgbToHex,
  setRenderLibPath,
  strikethrough,
  stringToStyledText,
  stringWidth,
  stripAnsiSequences,
  t,
  terminalNamedSingleStrokeKeys,
  treeSitterToStyledText,
  treeSitterToTextChunks,
  underline,
  visualizeRenderableTree,
  white,
  wrapWithDelegates,
  yellow,
  yoga_exports
} from "./index-G6QM5OA3.js";

// src/post/color-bytes.ts
function toU8(value) {
  return Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 255);
}
function channel(buffer, index) {
  return (buffer[index] & 255) / 255;
}
function setRgb(buffer, base, r, g, b) {
  const a = buffer[base + 3] & 255;
  buffer[base] = toU8(r);
  buffer[base + 1] = toU8(g);
  buffer[base + 2] = toU8(b);
  buffer[base + 3] = a;
}

// src/post/effects.ts
var DistortionEffect = class {
  // --- Configurable Parameters ---
  glitchChancePerSecond = 0.5;
  maxGlitchLines = 3;
  minGlitchDuration = 0.05;
  maxGlitchDuration = 0.2;
  maxShiftAmount = 10;
  shiftFlipRatio = 0.6;
  colorGlitchChance = 0.2;
  // --- Internal State ---
  lastGlitchTime = 0;
  glitchDuration = 0;
  activeGlitches = [];
  constructor(options) {
    if (options) {
      Object.assign(this, options);
    }
  }
  /**
   * Applies the animated distortion/glitch effect to the buffer.
   */
  apply(buffer, deltaTime) {
    const width = buffer.width;
    const height = buffer.height;
    const buf = buffer.buffers;
    this.lastGlitchTime += deltaTime / 1e3;
    if (this.activeGlitches.length > 0 && this.lastGlitchTime >= this.glitchDuration) {
      this.activeGlitches = [];
      this.glitchDuration = 0;
    }
    if (this.activeGlitches.length === 0 && Math.random() < this.glitchChancePerSecond * (deltaTime / 1e3)) {
      this.lastGlitchTime = 0;
      this.glitchDuration = this.minGlitchDuration + Math.random() * (this.maxGlitchDuration - this.minGlitchDuration);
      const numGlitches = 1 + Math.floor(Math.random() * this.maxGlitchLines);
      for (let i = 0; i < numGlitches; i++) {
        const y = Math.floor(Math.random() * height);
        let type;
        let amount = 0;
        const typeRoll = Math.random();
        if (typeRoll < this.colorGlitchChance) {
          type = "color";
        } else {
          const shiftRoll = (typeRoll - this.colorGlitchChance) / (1 - this.colorGlitchChance);
          if (shiftRoll < this.shiftFlipRatio) {
            type = "shift";
            amount = Math.floor((Math.random() - 0.5) * 2 * this.maxShiftAmount);
          } else {
            type = "flip";
          }
        }
        if (!this.activeGlitches.some((g) => g.y === y)) {
          this.activeGlitches.push({ y, type, amount });
        }
      }
    }
    if (this.activeGlitches.length > 0) {
      let tempChar = null;
      let tempFg = null;
      let tempBg = null;
      let tempAttr = null;
      for (const glitch of this.activeGlitches) {
        const y = glitch.y;
        if (y < 0 || y >= height) continue;
        const baseIndex = y * width;
        if (glitch.type === "shift" || glitch.type === "flip") {
          if (!tempChar) {
            tempChar = new Uint32Array(width);
            tempFg = new Uint16Array(width * 4);
            tempBg = new Uint16Array(width * 4);
            tempAttr = new Uint8Array(width);
          }
          try {
            tempChar.set(buf.char.subarray(baseIndex, baseIndex + width));
            tempFg.set(buf.fg.subarray(baseIndex * 4, (baseIndex + width) * 4));
            tempBg.set(buf.bg.subarray(baseIndex * 4, (baseIndex + width) * 4));
            tempAttr.set(buf.attributes.subarray(baseIndex, baseIndex + width));
          } catch (e) {
            console.error(`Error copying row ${y} for distortion:`, e);
            continue;
          }
          if (glitch.type === "shift") {
            const shift = glitch.amount;
            for (let x = 0; x < width; x++) {
              const srcX = ((x - shift) % width + width) % width;
              const destIndex = baseIndex + x;
              const srcTempIndex = srcX;
              buf.char[destIndex] = tempChar[srcTempIndex];
              buf.attributes[destIndex] = tempAttr[srcTempIndex];
              const destColorIndex = destIndex * 4;
              const srcTempColorIndex = srcTempIndex * 4;
              buf.fg.set(tempFg.subarray(srcTempColorIndex, srcTempColorIndex + 4), destColorIndex);
              buf.bg.set(tempBg.subarray(srcTempColorIndex, srcTempColorIndex + 4), destColorIndex);
            }
          } else {
            for (let x = 0; x < width; x++) {
              const srcX = width - 1 - x;
              const destIndex = baseIndex + x;
              const srcTempIndex = srcX;
              buf.char[destIndex] = tempChar[srcTempIndex];
              buf.attributes[destIndex] = tempAttr[srcTempIndex];
              const destColorIndex = destIndex * 4;
              const srcTempColorIndex = srcTempIndex * 4;
              buf.fg.set(tempFg.subarray(srcTempColorIndex, srcTempColorIndex + 4), destColorIndex);
              buf.bg.set(tempBg.subarray(srcTempColorIndex, srcTempColorIndex + 4), destColorIndex);
            }
          }
        } else if (glitch.type === "color") {
          const glitchStart = Math.floor(Math.random() * width);
          const maxPossibleLength = width - glitchStart;
          let glitchLength = Math.floor(Math.random() * maxPossibleLength) + 1;
          if (Math.random() < 0.2) {
            glitchLength = Math.floor(Math.random() * (width / 4)) + 1;
          }
          glitchLength = Math.min(glitchLength, maxPossibleLength);
          for (let x = glitchStart; x < glitchStart + glitchLength; x++) {
            if (x >= width) break;
            const destIndex = baseIndex + x;
            const destColorIndex = destIndex * 4;
            let rFg, gFg, bFg, rBg, gBg, bBg;
            const colorMode = Math.random();
            if (colorMode < 0.33) {
              rFg = Math.random();
              gFg = Math.random();
              bFg = Math.random();
              rBg = Math.random();
              gBg = Math.random();
              bBg = Math.random();
            } else if (colorMode < 0.66) {
              const emphasis = Math.random();
              if (emphasis < 0.25) {
                rFg = Math.random();
                gFg = 0;
                bFg = 0;
              } else if (emphasis < 0.5) {
                rFg = 0;
                gFg = Math.random();
                bFg = 0;
              } else if (emphasis < 0.75) {
                rFg = 0;
                gFg = 0;
                bFg = Math.random();
              } else {
                const glitchColorRoll = Math.random();
                if (glitchColorRoll < 0.33) {
                  rFg = 1;
                  gFg = 0;
                  bFg = 1;
                } else if (glitchColorRoll < 0.66) {
                  rFg = 0;
                  gFg = 1;
                  bFg = 1;
                } else {
                  rFg = 1;
                  gFg = 1;
                  bFg = 0;
                }
              }
              if (Math.random() < 0.5) {
                rBg = 1 - rFg;
                gBg = 1 - gFg;
                bBg = 1 - bFg;
              } else {
                rBg = rFg * (Math.random() * 0.5 + 0.2);
                gBg = gFg * (Math.random() * 0.5 + 0.2);
                bBg = bFg * (Math.random() * 0.5 + 0.2);
              }
            } else {
              rFg = Math.random() > 0.5 ? 1 : 0;
              gFg = Math.random() > 0.5 ? 1 : 0;
              bFg = Math.random() > 0.5 ? 1 : 0;
              rBg = 1 - rFg;
              gBg = 1 - gFg;
              bBg = 1 - bFg;
            }
            setRgb(buf.fg, destColorIndex, rFg, gFg, bFg);
            setRgb(buf.bg, destColorIndex, rBg, gBg, bBg);
          }
        }
      }
    }
  }
};
var VignetteEffect = class _VignetteEffect {
  _strength;
  // Stores packed cell masks [x, y, attenuation] per pixel
  precomputedAttenuationCellMask = null;
  cachedWidth = -1;
  cachedHeight = -1;
  // Zero matrix for attenuation (maps everything toward black based on strength)
  static zeroMatrix = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  constructor(strength = 0.5) {
    this._strength = strength;
  }
  set strength(newStrength) {
    this._strength = Math.max(0, newStrength);
    this.cachedWidth = -1;
    this.cachedHeight = -1;
    this.precomputedAttenuationCellMask = null;
  }
  get strength() {
    return this._strength;
  }
  _computeFactors(width, height) {
    this.precomputedAttenuationCellMask = new Float32Array(width * height * 3);
    const centerX = width / 2;
    const centerY = height / 2;
    const maxDistSq = centerX * centerX + centerY * centerY;
    const safeMaxDistSq = maxDistSq === 0 ? 1 : maxDistSq;
    const strength = this._strength;
    let i = 0;
    for (let y = 0; y < height; y++) {
      const dy = y - centerY;
      const dySq = dy * dy;
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const distSq = dx * dx + dySq;
        const baseAttenuation = Math.min(1, distSq / safeMaxDistSq);
        const attenuation = baseAttenuation * strength;
        this.precomputedAttenuationCellMask[i++] = x;
        this.precomputedAttenuationCellMask[i++] = y;
        this.precomputedAttenuationCellMask[i++] = attenuation;
      }
    }
    this.cachedWidth = width;
    this.cachedHeight = height;
  }
  /**
   * Applies the vignette effect using native colorMatrix with a zero matrix.
   * The zero matrix maps all colors to black, and the attenuation cell masks
   * control how much of the effect is applied (strength-based blending).
   */
  apply(buffer) {
    const width = buffer.width;
    const height = buffer.height;
    if (width !== this.cachedWidth || height !== this.cachedHeight || !this.precomputedAttenuationCellMask) {
      this._computeFactors(width, height);
    }
    buffer.colorMatrix(_VignetteEffect.zeroMatrix, this.precomputedAttenuationCellMask, 1, 3);
  }
};
var PerlinNoise = class {
  perm;
  grad3 = [
    [1, 1, 0],
    [-1, 1, 0],
    [1, -1, 0],
    [-1, -1, 0],
    [1, 0, 1],
    [-1, 0, 1],
    [1, 0, -1],
    [-1, 0, -1],
    [0, 1, 1],
    [0, -1, 1],
    [0, 1, -1],
    [0, -1, -1]
  ];
  constructor() {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }
    for (let i = 255; i > 0; i--) {
      const r = Math.floor(Math.random() * (i + 1));
      [p[i], p[r]] = [p[r], p[i]];
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }
  dot(g, x, y, z) {
    return g[0] * x + g[1] * y + g[2] * z;
  }
  mix(a, b, t2) {
    return a + (b - a) * t2;
  }
  fade(t2) {
    return t2 * t2 * t2 * (t2 * (t2 * 6 - 15) + 10);
  }
  /**
   * 3D Perlin noise at coordinates (x, y, z)
   * Returns value in range [-1, 1]
   */
  noise3d(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = this.fade(xf);
    const v = this.fade(yf);
    const w = this.fade(zf);
    const A = this.perm[X] + Y;
    const AA = this.perm[A] + Z;
    const AB = this.perm[A + 1] + Z;
    const B = this.perm[X + 1] + Y;
    const BA = this.perm[B] + Z;
    const BB = this.perm[B + 1] + Z;
    let res = this.mix(
      this.mix(
        this.mix(
          this.dot(this.grad3[this.perm[AA] % 12], xf, yf, zf),
          this.dot(this.grad3[this.perm[BA] % 12], xf - 1, yf, zf),
          u
        ),
        this.mix(
          this.dot(this.grad3[this.perm[AB] % 12], xf, yf - 1, zf),
          this.dot(this.grad3[this.perm[BB] % 12], xf - 1, yf - 1, zf),
          u
        ),
        v
      ),
      this.mix(
        this.mix(
          this.dot(this.grad3[this.perm[AA + 1] % 12], xf, yf, zf - 1),
          this.dot(this.grad3[this.perm[BA + 1] % 12], xf - 1, yf, zf - 1),
          u
        ),
        this.mix(
          this.dot(this.grad3[this.perm[AB + 1] % 12], xf, yf - 1, zf - 1),
          this.dot(this.grad3[this.perm[BB + 1] % 12], xf - 1, yf - 1, zf - 1),
          u
        ),
        v
      ),
      w
    );
    return res;
  }
};
var CloudsEffect = class {
  noise;
  _scale;
  _speed;
  _density;
  _darkness;
  time = 0;
  constructor(scale = 0.02, speed = 0.5, density = 0.6, darkness = 0.7) {
    this.noise = new PerlinNoise();
    this._scale = scale;
    this._speed = speed;
    this._density = density;
    this._darkness = darkness;
  }
  set scale(newScale) {
    this._scale = Math.max(1e-3, newScale);
  }
  get scale() {
    return this._scale;
  }
  set speed(newSpeed) {
    this._speed = Math.max(0, newSpeed);
  }
  get speed() {
    return this._speed;
  }
  set density(newDensity) {
    this._density = Math.max(0, Math.min(1, newDensity));
  }
  get density() {
    return this._density;
  }
  set darkness(newDarkness) {
    this._darkness = Math.max(0, Math.min(1, newDarkness));
  }
  get darkness() {
    return this._darkness;
  }
  /**
   * Applies cloud shadow effect using Perlin noise mask with native colorMatrix.
   * Uses FBM (Fractal Brownian Motion) for detailed clouds, offloaded to native code.
   */
  apply(buffer, deltaTime) {
    const width = buffer.width;
    const height = buffer.height;
    this.time += deltaTime / 1e3 * this._speed;
    const scale = this._scale;
    const timeOffset = this.time;
    const cellMask = new Float32Array(width * height * 3);
    let maskIdx = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let noiseValue = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;
        for (let i = 0; i < 4; i++) {
          const nx = (x * scale * frequency + timeOffset) * 0.5;
          const ny = y * scale * frequency * 0.5;
          const nz = timeOffset * 0.3;
          noiseValue += this.noise.noise3d(nx, ny, nz) * amplitude;
          maxValue += amplitude;
          amplitude *= 0.5;
          frequency *= 2;
        }
        noiseValue = (noiseValue / maxValue + 1) * 0.5;
        const cloudDensity = Math.max(0, noiseValue - (1 - this._density));
        const attenuation = cloudDensity * this._darkness;
        cellMask[maskIdx++] = x;
        cellMask[maskIdx++] = y;
        cellMask[maskIdx++] = attenuation;
      }
    }
    const zeroMatrix = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    buffer.colorMatrix(zeroMatrix, cellMask, 1, 2);
  }
};
var FlamesEffect = class {
  noise;
  _scale;
  _speed;
  _intensity;
  time = 0;
  constructor(scale = 0.03, speed = 0.02, intensity = 0.8) {
    this.noise = new PerlinNoise();
    this._scale = scale;
    this._speed = speed;
    this._intensity = intensity;
  }
  set scale(newScale) {
    this._scale = Math.max(1e-3, newScale);
  }
  get scale() {
    return this._scale;
  }
  set speed(newSpeed) {
    this._speed = Math.max(0, newSpeed);
  }
  get speed() {
    return this._speed;
  }
  set intensity(newIntensity) {
    this._intensity = Math.max(0, Math.min(1, newIntensity));
  }
  get intensity() {
    return this._intensity;
  }
  /**
   * Applies flame effect rising from bottom using Perlin noise.
   * Flames get cooler (redder) and fade as they rise.
   */
  apply(buffer, deltaTime) {
    const width = buffer.width;
    const height = buffer.height;
    const bg2 = buffer.buffers.bg;
    this.time += deltaTime / 1e3 * this._speed;
    const scale = this._scale;
    const timeOffset = this.time;
    for (let y = 0; y < height; y++) {
      const heightFactor = 1 - y / height;
      for (let x = 0; x < width; x++) {
        let noiseValue = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;
        for (let i = 0; i < 3; i++) {
          const nx = (x * scale * frequency + timeOffset) * 0.5;
          const ny = (height - y) * scale * frequency * 2 * 0.5;
          const nz = timeOffset * 2;
          noiseValue += this.noise.noise3d(nx, ny, nz) * amplitude;
          maxValue += amplitude;
          amplitude *= 0.5;
          frequency *= 2;
        }
        noiseValue = (noiseValue / maxValue + 1) * 0.5;
        const flameIntensity = noiseValue * heightFactor * this._intensity;
        if (flameIntensity > 0) {
          const colorIndex = (y * width + x) * 4;
          let r, g, b;
          if (flameIntensity > 0.7) {
            r = 1;
            g = 1;
            b = 0.3 + (flameIntensity - 0.7) * 2.3;
          } else if (flameIntensity > 0.4) {
            r = 1;
            g = 0.5 + (flameIntensity - 0.4) * 1.67;
            b = 0;
          } else {
            r = 0.3 + flameIntensity * 1.75;
            g = flameIntensity * 0.5;
            b = 0;
          }
          setRgb(
            bg2,
            colorIndex,
            Math.max(channel(bg2, colorIndex), r * flameIntensity),
            Math.max(channel(bg2, colorIndex + 1), g * flameIntensity),
            Math.max(channel(bg2, colorIndex + 2), b * flameIntensity)
          );
        }
      }
    }
  }
};
var CRTRollingBarEffect = class {
  _speed;
  _height;
  _intensity;
  _fadeDistance;
  position = 0;
  constructor(speed = 0.5, height = 0.15, intensity = 0.3, fadeDistance = 0.3) {
    this._speed = speed;
    this._height = Math.max(0.01, Math.min(0.5, height));
    this._intensity = Math.max(0, Math.min(1, intensity));
    this._fadeDistance = Math.max(0, Math.min(1, fadeDistance));
  }
  set speed(newSpeed) {
    this._speed = newSpeed;
  }
  get speed() {
    return this._speed;
  }
  set height(newHeight) {
    this._height = Math.max(0.01, Math.min(0.5, newHeight));
  }
  get height() {
    return this._height;
  }
  set intensity(newIntensity) {
    this._intensity = Math.max(0, Math.min(1, newIntensity));
  }
  get intensity() {
    return this._intensity;
  }
  set fadeDistance(newFadeDistance) {
    this._fadeDistance = Math.max(0, Math.min(1, newFadeDistance));
  }
  get fadeDistance() {
    return this._fadeDistance;
  }
  /**
   * Applies the rolling bar effect to the buffer.
   * Creates a smooth horizontal bar that scans down the screen with a bell-curve gradient.
   * The bar has a bright center that smoothly fades to the edges.
   */
  apply(buffer, deltaTime) {
    const width = buffer.width;
    const height = buffer.height;
    const fg2 = buffer.buffers.fg;
    const bg2 = buffer.buffers.bg;
    this.position += deltaTime / 1e3 * this._speed;
    const cycleHeight = height + this._height * height * 2;
    if (cycleHeight > 0) {
      this.position = (this.position % cycleHeight + cycleHeight) % cycleHeight;
    }
    const barPixelHeight = this._height * height;
    const fadePixelDistance = this._fadeDistance * barPixelHeight;
    const totalEffectHeight = barPixelHeight + fadePixelDistance * 2;
    const effectCenter = this.position - totalEffectHeight / 2 + barPixelHeight / 2;
    for (let y = 0; y < height; y++) {
      const distFromCenter = Math.abs(y - effectCenter);
      let barFactor = 0;
      if (distFromCenter <= totalEffectHeight / 2) {
        const normalizedDist = distFromCenter / (totalEffectHeight / 2);
        barFactor = Math.cos(normalizedDist * Math.PI / 2);
      }
      if (barFactor > 1e-3) {
        const rowMultiplier = 1 + this._intensity * barFactor;
        for (let x = 0; x < width; x++) {
          const colorIndex = (y * width + x) * 4;
          setRgb(
            fg2,
            colorIndex,
            Math.min(1, channel(fg2, colorIndex) * rowMultiplier),
            Math.min(1, channel(fg2, colorIndex + 1) * rowMultiplier),
            Math.min(1, channel(fg2, colorIndex + 2) * rowMultiplier)
          );
          setRgb(
            bg2,
            colorIndex,
            Math.min(1, channel(bg2, colorIndex) * rowMultiplier),
            Math.min(1, channel(bg2, colorIndex + 1) * rowMultiplier),
            Math.min(1, channel(bg2, colorIndex + 2) * rowMultiplier)
          );
        }
      }
    }
  }
};
var RainbowTextEffect = class {
  _speed;
  _saturation;
  _value;
  _repeats;
  time = 0;
  constructor(speed = 0.01, saturation = 1, value = 1, repeats = 3) {
    this._speed = speed;
    this._saturation = saturation;
    this._value = value;
    this._repeats = repeats;
  }
  set speed(newSpeed) {
    this._speed = Math.max(0, newSpeed);
  }
  get speed() {
    return this._speed;
  }
  set saturation(newSaturation) {
    this._saturation = Math.max(0, Math.min(1, newSaturation));
  }
  get saturation() {
    return this._saturation;
  }
  set value(newValue) {
    this._value = Math.max(0, Math.min(1, newValue));
  }
  get value() {
    return this._value;
  }
  set repeats(newRepeats) {
    this._repeats = Math.max(0.1, newRepeats);
  }
  get repeats() {
    return this._repeats;
  }
  /**
   * Converts HSV color to RGB
   * @param h - Hue [0, 1]
   * @param s - Saturation [0, 1]
   * @param v - Value [0, 1]
   * @returns [r, g, b] each in [0, 1]
   */
  hsvToRgb(h2, s, v) {
    let r = 0, g = 0, b = 0;
    const i = Math.floor(h2 * 6);
    const f = h2 * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t2 = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0:
        r = v;
        g = t2;
        b = p;
        break;
      case 1:
        r = q;
        g = v;
        b = p;
        break;
      case 2:
        r = p;
        g = v;
        b = t2;
        break;
      case 3:
        r = p;
        g = q;
        b = v;
        break;
      case 4:
        r = t2;
        g = p;
        b = v;
        break;
      case 5:
        r = v;
        g = p;
        b = q;
        break;
    }
    return [r, g, b];
  }
  /**
   * Applies rainbow colors to cells with white foreground.
   * White is defined as R, G, B all >= 0.9
   */
  apply(buffer, deltaTime) {
    const width = buffer.width;
    const height = buffer.height;
    const fg2 = buffer.buffers.fg;
    this.time += deltaTime / 1e3 * this._speed;
    const saturation = this._saturation;
    const value = this._value;
    const repeats = this._repeats;
    const angleRad = 25 * Math.PI / 180;
    const cosAngle = Math.cos(angleRad);
    const sinAngle = Math.sin(angleRad);
    const whiteThreshold = 0.9;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const colorIndex = (y * width + x) * 4;
        const r = channel(fg2, colorIndex);
        const g = channel(fg2, colorIndex + 1);
        const b = channel(fg2, colorIndex + 2);
        if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) {
          const projection = x * cosAngle + y * sinAngle;
          const maxProjection = width * cosAngle + height * sinAngle;
          const hue = (projection / maxProjection * repeats + this.time * 0.1) % 1;
          const [newR, newG, newB] = this.hsvToRgb(hue, saturation, value);
          setRgb(fg2, colorIndex, newR, newG, newB);
        }
      }
    }
  }
};

// src/post/filters.ts
function applyScanlines(buffer, strength = 0.8, step = 2) {
  if (strength === 1 || step < 1) return;
  const width = buffer.width;
  const height = buffer.height;
  const affectedRows = Math.ceil(height / step);
  const cellCount = width * affectedRows;
  const cellMask = new Float32Array(cellCount * 3);
  let maskIdx = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x++) {
      cellMask[maskIdx++] = x;
      cellMask[maskIdx++] = y;
      cellMask[maskIdx++] = 1;
    }
  }
  const s = strength;
  const matrix = new Float32Array([
    s,
    0,
    0,
    0,
    // Row 0: Red output
    0,
    s,
    0,
    0,
    // Row 1: Green output
    0,
    0,
    s,
    0,
    // Row 2: Blue output
    0,
    0,
    0,
    1
    // Row 3: Alpha output (identity)
  ]);
  buffer.colorMatrix(matrix, cellMask, 1, 2);
}
function applyInvert(buffer, strength = 1) {
  if (strength === 0) return;
  const matrix = new Float32Array([
    -1,
    0,
    0,
    1,
    // Row 0: Red output = -1*R + 0*G + 0*B + 1*A = 1 - R
    0,
    -1,
    0,
    1,
    // Row 1: Green output = 1 - G
    0,
    0,
    -1,
    1,
    // Row 2: Blue output = 1 - B
    0,
    0,
    0,
    1
    // Row 3: Alpha output = A
  ]);
  buffer.colorMatrixUniform(matrix, strength, 3);
}
function applyNoise(buffer, strength = 0.1) {
  const width = buffer.width;
  const height = buffer.height;
  const size = width * height;
  if (strength === 0) return;
  const cellMask = new Float32Array(size * 3);
  let cellMaskIndex = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cellMask[cellMaskIndex++] = x;
      cellMask[cellMaskIndex++] = y;
      cellMask[cellMaskIndex++] = (Math.random() - 0.5) * 2;
    }
  }
  const b = 1 + strength;
  const matrix = new Float32Array([
    b,
    0,
    0,
    0,
    // Row 0 (Red output)
    0,
    b,
    0,
    0,
    // Row 1 (Green output)
    0,
    0,
    b,
    0,
    // Row 2 (Blue output)
    0,
    0,
    0,
    1
    // Row 3 (Alpha output - identity)
  ]);
  buffer.colorMatrix(matrix, cellMask, 1, 3);
}
function applyChromaticAberration(buffer, strength = 1) {
  const width = buffer.width;
  const height = buffer.height;
  const srcFg = Uint16Array.from(buffer.buffers.fg);
  const destFg = buffer.buffers.fg;
  const centerX = width / 2;
  const centerY = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const offset = Math.round(Math.sqrt(dx * dx + dy * dy) / Math.max(centerX, centerY) * strength);
      const rX = Math.max(0, Math.min(width - 1, x - offset));
      const bX = Math.max(0, Math.min(width - 1, x + offset));
      const rIndex = (y * width + rX) * 4;
      const gIndex = (y * width + x) * 4;
      const bIndex = (y * width + bX) * 4;
      const destIndex = (y * width + x) * 4;
      setRgb(destFg, destIndex, channel(srcFg, rIndex), channel(srcFg, gIndex + 1), channel(srcFg, bIndex + 2));
    }
  }
}
function applyAsciiArt(buffer, ramp = ' .\'`^"",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$', fgColor = { r: 1, g: 1, b: 1 }, bgColor = { r: 0, g: 0, b: 0 }) {
  const width = buffer.width;
  const height = buffer.height;
  const chars = buffer.buffers.char;
  const bg2 = buffer.buffers.bg;
  const rampLength = ramp.length;
  if (rampLength === 0) return;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const colorIndex = index * 4;
      const bgR = channel(bg2, colorIndex);
      const bgG = channel(bg2, colorIndex + 1);
      const bgB = channel(bg2, colorIndex + 2);
      const lum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
      const rampIndex = Math.min(rampLength - 1, Math.floor(lum * rampLength));
      chars[index] = ramp[rampIndex].charCodeAt(0);
    }
  }
  const fgMatrix = new Float32Array([
    0,
    0,
    0,
    fgColor.r,
    // Red output
    0,
    0,
    0,
    fgColor.g,
    // Green output
    0,
    0,
    0,
    fgColor.b,
    // Blue output
    0,
    0,
    0,
    1
    // Alpha output (identity)
  ]);
  const bgMatrix = new Float32Array([
    0,
    0,
    0,
    bgColor.r,
    // Red output
    0,
    0,
    0,
    bgColor.g,
    // Green output
    0,
    0,
    0,
    bgColor.b,
    // Blue output
    0,
    0,
    0,
    1
    // Alpha output (identity)
  ]);
  buffer.colorMatrixUniform(fgMatrix, 1, 1);
  buffer.colorMatrixUniform(bgMatrix, 1, 2);
}
function applyBrightness(buffer, brightness = 0, cellMask) {
  if (brightness === 0) return;
  const b = brightness;
  const matrix = new Float32Array([
    1,
    0,
    0,
    b,
    // Row 0 (Red output = R + brightness*A)
    0,
    1,
    0,
    b,
    // Row 1 (Green output = G + brightness*A)
    0,
    0,
    1,
    b,
    // Row 2 (Blue output = B + brightness*A)
    0,
    0,
    0,
    1
    // Row 3 (Alpha output = A)
  ]);
  if (!cellMask || cellMask.length === 0) {
    buffer.colorMatrixUniform(matrix, 1, 3);
  } else {
    buffer.colorMatrix(matrix, cellMask, 1, 3);
  }
}
function applyGain(buffer, gain = 1, cellMask) {
  if (gain === 1) return;
  const g = Math.max(0, gain);
  const matrix = new Float32Array([
    g,
    0,
    0,
    0,
    // Row 0 (Red output)
    0,
    g,
    0,
    0,
    // Row 1 (Green output)
    0,
    0,
    g,
    0,
    // Row 2 (Blue output)
    0,
    0,
    0,
    1
    // Row 3 (Alpha output - identity)
  ]);
  if (!cellMask || cellMask.length === 0) {
    buffer.colorMatrixUniform(matrix, 1, 3);
  } else {
    buffer.colorMatrix(matrix, cellMask, 1, 3);
  }
}
function createSaturationMatrix(saturation) {
  const s = Math.max(0, saturation);
  const sr = 0.299 * (1 - s);
  const sg = 0.587 * (1 - s);
  const sb = 0.114 * (1 - s);
  const m00 = sr + s;
  const m01 = sg;
  const m02 = sb;
  const m10 = sr;
  const m11 = sg + s;
  const m12 = sb;
  const m20 = sr;
  const m21 = sg;
  const m22 = sb + s;
  return new Float32Array([
    m00,
    m01,
    m02,
    0,
    // Red output row
    m10,
    m11,
    m12,
    0,
    // Green output row
    m20,
    m21,
    m22,
    0,
    // Blue output row
    0,
    0,
    0,
    1
    // Alpha output row (identity)
  ]);
}
function applySaturation(buffer, cellMask, strength = 1) {
  if (strength === 1 || strength === 0) {
    return;
  }
  const matrix = createSaturationMatrix(strength);
  if (!cellMask || cellMask.length === 0) {
    buffer.colorMatrixUniform(matrix, 1, 3);
  } else {
    buffer.colorMatrix(matrix, cellMask, 1, 3);
  }
}
var BloomEffect = class {
  _threshold;
  _strength;
  _radius;
  constructor(threshold = 0.8, strength = 0.2, radius = 2) {
    this._threshold = Math.max(0, Math.min(1, threshold));
    this._strength = Math.max(0, strength);
    this._radius = Math.max(0, Math.round(radius));
  }
  set threshold(newThreshold) {
    this._threshold = Math.max(0, Math.min(1, newThreshold));
  }
  get threshold() {
    return this._threshold;
  }
  set strength(newStrength) {
    this._strength = Math.max(0, newStrength);
  }
  get strength() {
    return this._strength;
  }
  set radius(newRadius) {
    this._radius = Math.max(0, Math.round(newRadius));
  }
  get radius() {
    return this._radius;
  }
  apply(buffer) {
    const threshold = this._threshold;
    const strength = this._strength;
    const radius = this._radius;
    if (strength <= 0 || radius <= 0) return;
    const width = buffer.width;
    const height = buffer.height;
    const srcFg = Uint16Array.from(buffer.buffers.fg);
    const srcBg = Uint16Array.from(buffer.buffers.bg);
    const destFg = buffer.buffers.fg;
    const destBg = buffer.buffers.bg;
    const brightPixels = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const fgLum = 0.299 * channel(srcFg, index) + 0.587 * channel(srcFg, index + 1) + 0.114 * channel(srcFg, index + 2);
        const bgLum = 0.299 * channel(srcBg, index) + 0.587 * channel(srcBg, index + 1) + 0.114 * channel(srcBg, index + 2);
        const lum = Math.max(fgLum, bgLum);
        if (lum > threshold) {
          const intensity = (lum - threshold) / (1 - threshold + 1e-6);
          brightPixels.push({ x, y, intensity: Math.max(0, intensity) });
        }
      }
    }
    if (brightPixels.length === 0) return;
    destFg.set(srcFg);
    destBg.set(srcBg);
    for (const bright of brightPixels) {
      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          if (kx === 0 && ky === 0) continue;
          const sampleX = bright.x + kx;
          const sampleY = bright.y + ky;
          if (sampleX >= 0 && sampleX < width && sampleY >= 0 && sampleY < height) {
            const distSq = kx * kx + ky * ky;
            const radiusSq = radius * radius;
            if (distSq <= radiusSq) {
              const falloff = 1 - distSq / radiusSq;
              const bloomAmount = bright.intensity * strength * falloff;
              const destIndex = (sampleY * width + sampleX) * 4;
              setRgb(
                destFg,
                destIndex,
                Math.min(1, channel(destFg, destIndex) + bloomAmount),
                Math.min(1, channel(destFg, destIndex + 1) + bloomAmount),
                Math.min(1, channel(destFg, destIndex + 2) + bloomAmount)
              );
              setRgb(
                destBg,
                destIndex,
                Math.min(1, channel(destBg, destIndex) + bloomAmount),
                Math.min(1, channel(destBg, destIndex + 1) + bloomAmount),
                Math.min(1, channel(destBg, destIndex + 2) + bloomAmount)
              );
            }
          }
        }
      }
    }
  }
};

// src/post/matrices.ts
var SEPIA_MATRIX = new Float32Array([
  0.393,
  0.769,
  0.189,
  0,
  // Red output (r->r, g->r, b->r, a->r)
  0.349,
  0.686,
  0.168,
  0,
  // Green output (r->g, g->g, b->g, a->g)
  0.272,
  0.534,
  0.131,
  0,
  // Blue output (r->b, g->b, b->b, a->b)
  0,
  0,
  0,
  1
  // Alpha output (r->a, g->a, b->a, a->a) - identity
]);
var PROTANOPIA_SIM_MATRIX = new Float32Array([
  0.567,
  0.433,
  0,
  0,
  // Red output
  0.558,
  0.442,
  0,
  0,
  // Green output
  0,
  0.242,
  0.758,
  0,
  // Blue output
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var DEUTERANOPIA_SIM_MATRIX = new Float32Array([
  0.625,
  0.375,
  0,
  0,
  // Red output
  0.7,
  0.3,
  0,
  0,
  // Green output
  0,
  0.3,
  0.7,
  0,
  // Blue output
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var TRITANOPIA_SIM_MATRIX = new Float32Array([
  0.95,
  0.05,
  0,
  0,
  // Red output
  0,
  0.433,
  0.567,
  0,
  // Green output
  0,
  0.475,
  0.525,
  0,
  // Blue output
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var ACHROMATOPSIA_MATRIX = new Float32Array([
  0.299,
  0.587,
  0.114,
  0,
  // Red output (luminance)
  0.299,
  0.587,
  0.114,
  0,
  // Green output (luminance)
  0.299,
  0.587,
  0.114,
  0,
  // Blue output (luminance)
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var PROTANOPIA_COMP_MATRIX = new Float32Array([
  1,
  0.2,
  0,
  0,
  // Boost red channel
  0,
  0.9,
  0.1,
  0,
  // Adjust green
  0,
  0.1,
  0.9,
  0,
  // Enhance blue
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var DEUTERANOPIA_COMP_MATRIX = new Float32Array([
  0.9,
  0.1,
  0,
  0,
  // Adjust red
  0.2,
  0.8,
  0,
  0,
  // Boost green channel
  0,
  0,
  1,
  0,
  // Keep blue
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var TRITANOPIA_COMP_MATRIX = new Float32Array([
  1,
  0,
  0,
  0,
  // Keep red
  0,
  0.9,
  0.1,
  0,
  // Adjust green
  0.1,
  0,
  0.9,
  0,
  // Boost blue channel
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var TECHNICOLOR_MATRIX = new Float32Array([
  1.5,
  -0.2,
  -0.3,
  0,
  // Red output - boosted with reduced green/blue influence
  -0.3,
  1.4,
  -0.1,
  0,
  // Green output - boosted with reduced red/blue influence
  -0.2,
  -0.2,
  1.4,
  0,
  // Blue output - slightly boosted
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var SOLARIZATION_MATRIX = new Float32Array([
  -0.5,
  0.5,
  0.5,
  0,
  // Red output - partial negative
  0.5,
  -0.5,
  0.5,
  0,
  // Green output - partial negative
  0.5,
  0.5,
  -0.5,
  0,
  // Blue output - partial negative
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var SYNTHWAVE_MATRIX = new Float32Array([
  1,
  0,
  0.25,
  0,
  // Red output - full red + some blue = magenta when bright
  0.1,
  0.1,
  0.1,
  0,
  // Green output - heavily suppressed, minimal contribution
  0.25,
  0,
  1,
  0,
  // Blue output - full blue + some red = enhances magenta tones
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var GREENSCALE_MATRIX = new Float32Array([
  0,
  0,
  0,
  0,
  // Red output - zeroed out
  0.299,
  0.587,
  0.114,
  0,
  // Green output - full luminance from all channels
  0,
  0,
  0,
  0,
  // Blue output - zeroed out
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var GRAYSCALE_MATRIX = new Float32Array([
  0.299,
  0.587,
  0.114,
  0,
  // Red output - luminance from all channels
  0.299,
  0.587,
  0.114,
  0,
  // Green output - luminance from all channels
  0.299,
  0.587,
  0.114,
  0,
  // Blue output - luminance from all channels
  0,
  0,
  0,
  1
  // Alpha output - identity
]);
var INVERT_MATRIX = new Float32Array([
  -1,
  0,
  0,
  1,
  // Red output = 1 - R
  0,
  -1,
  0,
  1,
  // Green output = 1 - G
  0,
  0,
  -1,
  1,
  // Blue output = 1 - B
  0,
  0,
  0,
  1
  // Alpha output - identity
]);

// src/animation/Timeline.ts
function resolveStartTime(startTime) {
  if (typeof startTime === "string") {
    const parsed = Number(startTime);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return startTime;
}
var easingFunctions = {
  linear: (t2) => t2,
  inQuad: (t2) => t2 * t2,
  outQuad: (t2) => t2 * (2 - t2),
  inOutQuad: (t2) => t2 < 0.5 ? 2 * t2 * t2 : -1 + (4 - 2 * t2) * t2,
  inExpo: (t2) => t2 === 0 ? 0 : Math.pow(2, 10 * (t2 - 1)),
  outExpo: (t2) => t2 === 1 ? 1 : 1 - Math.pow(2, -10 * t2),
  inOutSine: (t2) => -(Math.cos(Math.PI * t2) - 1) / 2,
  outBounce: (t2) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t2 < 1 / d1) {
      return n1 * t2 * t2;
    } else if (t2 < 2 / d1) {
      return n1 * (t2 -= 1.5 / d1) * t2 + 0.75;
    } else if (t2 < 2.5 / d1) {
      return n1 * (t2 -= 2.25 / d1) * t2 + 0.9375;
    } else {
      return n1 * (t2 -= 2.625 / d1) * t2 + 0.984375;
    }
  },
  outElastic: (t2) => {
    const c4 = 2 * Math.PI / 3;
    return t2 === 0 ? 0 : t2 === 1 ? 1 : Math.pow(2, -10 * t2) * Math.sin((t2 * 10 - 0.75) * c4) + 1;
  },
  inBounce: (t2) => 1 - easingFunctions.outBounce(1 - t2),
  inCirc: (t2) => 1 - Math.sqrt(1 - t2 * t2),
  outCirc: (t2) => Math.sqrt(1 - Math.pow(t2 - 1, 2)),
  inOutCirc: (t2) => {
    if ((t2 *= 2) < 1) return -0.5 * (Math.sqrt(1 - t2 * t2) - 1);
    return 0.5 * (Math.sqrt(1 - (t2 -= 2) * t2) + 1);
  },
  inBack: (t2, s = 1.70158) => t2 * t2 * ((s + 1) * t2 - s),
  outBack: (t2, s = 1.70158) => --t2 * t2 * ((s + 1) * t2 + s) + 1,
  inOutBack: (t2, s = 1.70158) => {
    s *= 1.525;
    if ((t2 *= 2) < 1) return 0.5 * (t2 * t2 * ((s + 1) * t2 - s));
    return 0.5 * ((t2 -= 2) * t2 * ((s + 1) * t2 + s) + 2);
  }
};
function captureInitialValues(item) {
  if (!item.properties) return;
  if (!item.initialValues || item.initialValues.length === 0) {
    const initialValues = [];
    for (let i = 0; i < item.target.length; i++) {
      const target = item.target[i];
      const targetInitialValues = {};
      for (const key of Object.keys(item.properties)) {
        if (typeof target[key] === "number") {
          targetInitialValues[key] = target[key];
        }
      }
      initialValues.push(targetInitialValues);
    }
    item.initialValues = initialValues;
  }
}
function applyAnimationAtProgress(item, progress, reversed, timelineTime, deltaTime = 0) {
  if (!item.properties || !item.initialValues) return;
  const easingFn = easingFunctions[item.ease || "linear"] || easingFunctions.linear;
  const easedProgress = easingFn(Math.max(0, Math.min(1, progress)));
  const finalProgress = reversed ? 1 - easedProgress : easedProgress;
  for (let i = 0; i < item.target.length; i++) {
    const target = item.target[i];
    const targetInitialValues = item.initialValues[i];
    if (!targetInitialValues) continue;
    for (const [key, endValue] of Object.entries(item.properties)) {
      const startValue = targetInitialValues[key];
      const newValue = startValue + (endValue - startValue) * finalProgress;
      target[key] = newValue;
    }
  }
  if (item.onUpdate) {
    const animation = {
      targets: item.target,
      progress: easedProgress,
      currentTime: timelineTime,
      deltaTime
    };
    item.onUpdate(animation);
  }
}
function evaluateAnimation(item, timelineTime, deltaTime = 0) {
  if (timelineTime < item.startTime) {
    return;
  }
  const animationTime = timelineTime - item.startTime;
  const duration = item.duration || 0;
  if (timelineTime >= item.startTime && !item.started) {
    captureInitialValues(item);
    if (item.onStart) {
      item.onStart();
    }
    item.started = true;
  }
  if (duration === 0) {
    if (!item.completed) {
      applyAnimationAtProgress(item, 1, false, timelineTime, deltaTime);
      if (item.onComplete) {
        item.onComplete();
      }
      item.completed = true;
    }
    return;
  }
  const maxLoops = !item.loop || item.loop === 1 ? 1 : typeof item.loop === "number" ? item.loop : Infinity;
  const loopDelay = item.loopDelay || 0;
  const cycleTime = duration + loopDelay;
  let currentCycle = Math.floor(animationTime / cycleTime);
  let timeInCycle = animationTime % cycleTime;
  if (item.onLoop && item.currentLoop !== void 0 && currentCycle > item.currentLoop && currentCycle < maxLoops) {
    item.onLoop();
  }
  item.currentLoop = currentCycle;
  if (!item.completed && currentCycle === maxLoops - 1 && timeInCycle >= duration) {
    const finalLoopReversed = (item.alternate || false) && currentCycle % 2 === 1;
    applyAnimationAtProgress(item, 1, finalLoopReversed, timelineTime, deltaTime);
    item.onComplete?.();
    item.completed = true;
    return;
  }
  if (currentCycle >= maxLoops) {
    if (!item.completed) {
      const finalReversed = (item.alternate || false) && (maxLoops - 1) % 2 === 1;
      applyAnimationAtProgress(item, 1, finalReversed, timelineTime, deltaTime);
      if (item.onComplete) {
        item.onComplete();
      }
      item.completed = true;
    }
    return;
  }
  if (timeInCycle === 0 && animationTime > 0 && currentCycle < maxLoops) {
    currentCycle = currentCycle - 1;
    timeInCycle = cycleTime;
  }
  if (timeInCycle >= duration) {
    const isReversed2 = (item.alternate || false) && currentCycle % 2 === 1;
    applyAnimationAtProgress(item, 1, isReversed2, timelineTime, deltaTime);
    return;
  }
  const progress = timeInCycle / duration;
  const isReversed = (item.alternate || false) && currentCycle % 2 === 1;
  applyAnimationAtProgress(item, progress, isReversed, timelineTime, deltaTime);
}
function evaluateCallback(item, timelineTime) {
  if (!item.executed && timelineTime >= item.startTime && item.callback) {
    item.callback();
    item.executed = true;
  }
}
function evaluateTimelineSync(item, timelineTime, deltaTime = 0) {
  if (!item.timeline) return;
  if (timelineTime < item.startTime) {
    return;
  }
  if (!item.timelineStarted) {
    item.timelineStarted = true;
    item.timeline.play();
    const overshoot = timelineTime - item.startTime;
    item.timeline.update(overshoot);
    return;
  }
  item.timeline.update(deltaTime);
}
function evaluateItem(item, timelineTime, deltaTime = 0) {
  if (item.type === "animation") {
    evaluateAnimation(item, timelineTime, deltaTime);
  } else if (item.type === "callback") {
    evaluateCallback(item, timelineTime);
  }
}
var Timeline = class {
  items = [];
  subTimelines = [];
  currentTime = 0;
  isPlaying = false;
  isComplete = false;
  duration;
  loop;
  synced = false;
  autoplay;
  onComplete;
  onPause;
  stateChangeListeners = [];
  constructor(options = {}) {
    this.duration = options.duration ?? 1e3;
    this.loop = options.loop === true;
    this.autoplay = options.autoplay !== false;
    this.onComplete = options.onComplete;
    this.onPause = options.onPause;
  }
  addStateChangeListener(listener) {
    this.stateChangeListeners.push(listener);
  }
  removeStateChangeListener(listener) {
    this.stateChangeListeners = this.stateChangeListeners.filter((l) => l !== listener);
  }
  notifyStateChange() {
    for (const listener of this.stateChangeListeners) {
      listener(this);
    }
  }
  add(target, properties, startTime = 0) {
    const resolvedStartTime = resolveStartTime(startTime);
    const animationProperties = {};
    for (const key in properties) {
      if (!["duration", "ease", "onUpdate", "onComplete", "onStart", "onLoop", "loop", "loopDelay", "alternate"].includes(
        key
      )) {
        if (typeof properties[key] === "number") {
          animationProperties[key] = properties[key];
        }
      }
    }
    this.items.push({
      type: "animation",
      startTime: resolvedStartTime,
      target: Array.isArray(target) ? target : [target],
      properties: animationProperties,
      initialValues: [],
      // Will be captured when animation starts
      duration: properties.duration !== void 0 ? properties.duration : 1e3,
      ease: properties.ease || "linear",
      loop: properties.loop,
      loopDelay: properties.loopDelay || 0,
      alternate: properties.alternate || false,
      onUpdate: properties.onUpdate,
      onComplete: properties.onComplete,
      onStart: properties.onStart,
      onLoop: properties.onLoop,
      completed: false,
      started: false,
      currentLoop: 0,
      once: properties.once ?? false
    });
    return this;
  }
  once(target, properties) {
    this.add(
      target,
      {
        ...properties,
        once: true
      },
      this.currentTime
    );
    return this;
  }
  call(callback, startTime = 0) {
    const resolvedStartTime = resolveStartTime(startTime);
    this.items.push({
      type: "callback",
      startTime: resolvedStartTime,
      callback,
      executed: false
    });
    return this;
  }
  sync(timeline, startTime = 0) {
    const pending = [timeline];
    const visited = /* @__PURE__ */ new Set();
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === this) throw new Error("Cannot create a cyclic timeline sync");
      if (visited.has(current)) continue;
      visited.add(current);
      for (const child of current.subTimelines) pending.push(child.timeline);
    }
    if (timeline.synced) {
      throw new Error("Timeline already synced");
    }
    this.subTimelines.push({
      type: "timeline",
      startTime,
      timeline
    });
    timeline.synced = true;
    timeline.notifyStateChange();
    return this;
  }
  play() {
    if (this.isComplete) {
      return this.restart();
    }
    this.subTimelines.forEach((subTimeline) => {
      if (subTimeline.timelineStarted && !subTimeline.timeline.isComplete) {
        subTimeline.timeline.play();
      }
    });
    this.isPlaying = true;
    this.notifyStateChange();
    return this;
  }
  pause() {
    this.subTimelines.forEach((subTimeline) => {
      subTimeline.timeline.pause();
    });
    this.isPlaying = false;
    if (this.onPause) {
      this.onPause();
    }
    this.notifyStateChange();
    return this;
  }
  resetItems() {
    this.items.forEach((item) => {
      if (item.type === "callback") {
        item.executed = false;
      } else if (item.type === "animation") {
        item.completed = false;
        item.started = false;
        item.currentLoop = 0;
      }
    });
    this.subTimelines.forEach((subTimeline) => {
      subTimeline.timelineStarted = false;
      if (subTimeline.timeline) {
        subTimeline.timeline.restart();
        subTimeline.timeline.pause();
      }
    });
  }
  restart() {
    this.isComplete = false;
    this.currentTime = 0;
    this.isPlaying = true;
    this.resetItems();
    this.notifyStateChange();
    return this;
  }
  update(deltaTime) {
    if (!this.isPlaying) return;
    const nextTime = this.currentTime + deltaTime;
    const boundedTime = Math.min(nextTime, this.duration);
    const elapsed = boundedTime - this.currentTime;
    for (const subTimeline of this.subTimelines) {
      evaluateTimelineSync(subTimeline, boundedTime, elapsed);
    }
    this.currentTime = boundedTime;
    for (const item of this.items) {
      evaluateItem(item, this.currentTime, deltaTime);
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item.type === "animation" && item.once && item.completed) {
        this.items.splice(i, 1);
      }
    }
    if (this.loop && this.currentTime >= this.duration) {
      const overshoot = this.duration > 0 ? nextTime - this.duration : 0;
      this.resetItems();
      this.currentTime = 0;
      if (overshoot > 0) {
        this.update(overshoot);
      }
    } else if (!this.loop && this.currentTime >= this.duration) {
      this.currentTime = this.duration;
      this.isPlaying = false;
      this.isComplete = true;
      if (this.onComplete) {
        this.onComplete();
      }
      this.notifyStateChange();
    }
  }
};
var TimelineEngine = class {
  timelines = /* @__PURE__ */ new Set();
  renderer = null;
  frameCallback = null;
  isLive = false;
  defaults = {
    frameRate: 60
  };
  attach(renderer) {
    if (this.renderer) {
      this.detach();
    }
    this.renderer = renderer;
    this.frameCallback = async (deltaTime) => {
      this.update(deltaTime);
    };
    renderer.setFrameCallback(this.frameCallback);
    this.updateLiveState();
  }
  detach() {
    if (this.renderer && this.frameCallback) {
      this.renderer.removeFrameCallback(this.frameCallback);
      if (this.isLive) {
        this.renderer.dropLive();
        this.isLive = false;
      }
    }
    this.renderer = null;
    this.frameCallback = null;
  }
  updateLiveState() {
    if (!this.renderer) return;
    const hasRunningTimelines = Array.from(this.timelines).some(
      (timeline) => !timeline.synced && timeline.isPlaying && !timeline.isComplete
    );
    if (hasRunningTimelines && !this.isLive) {
      this.renderer.requestLive();
      this.isLive = true;
    } else if (!hasRunningTimelines && this.isLive) {
      this.renderer.dropLive();
      this.isLive = false;
    }
  }
  onTimelineStateChange = (timeline) => {
    this.updateLiveState();
  };
  register(timeline) {
    if (!this.timelines.has(timeline)) {
      this.timelines.add(timeline);
      timeline.addStateChangeListener(this.onTimelineStateChange);
      this.updateLiveState();
    }
  }
  unregister(timeline) {
    if (this.timelines.has(timeline)) {
      this.timelines.delete(timeline);
      timeline.removeStateChangeListener(this.onTimelineStateChange);
      this.updateLiveState();
    }
  }
  clear() {
    for (const timeline of this.timelines) {
      timeline.removeStateChangeListener(this.onTimelineStateChange);
    }
    this.timelines.clear();
    this.updateLiveState();
  }
  update(deltaTime) {
    for (const timeline of this.timelines) {
      if (!timeline.synced) {
        timeline.update(deltaTime);
      }
    }
  }
};
var engine = new TimelineEngine();
function createTimeline(options = {}) {
  const timeline = new Timeline(options);
  if (options.autoplay !== false) {
    timeline.play();
  }
  engine.register(timeline);
  return timeline;
}

// src/plugins/registry.ts
var noop = () => {
};
var DEFAULT_DEBUG_PLUGIN_ERRORS = false;
var DEFAULT_MAX_PLUGIN_ERRORS = 100;
function normalizeError(error) {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error(`Unknown plugin error: ${String(error)}`);
}
var SlotRegistry = class {
  plugins = [];
  sortedPluginsCache = null;
  listeners = /* @__PURE__ */ new Set();
  errorListeners = /* @__PURE__ */ new Set();
  pluginErrors = [];
  registrationOrder = 0;
  batchDepth = 0;
  batchedNotify = false;
  rendererInstance;
  hostContext;
  options;
  constructor(renderer, context, options = {}) {
    this.rendererInstance = renderer;
    this.hostContext = context;
    this.options = {
      debugPluginErrors: options.debugPluginErrors ?? DEFAULT_DEBUG_PLUGIN_ERRORS,
      maxPluginErrors: options.maxPluginErrors ?? DEFAULT_MAX_PLUGIN_ERRORS,
      onPluginError: options.onPluginError
    };
  }
  get renderer() {
    return this.rendererInstance;
  }
  get context() {
    return this.hostContext;
  }
  configure(options) {
    if ("debugPluginErrors" in options) {
      this.options.debugPluginErrors = options.debugPluginErrors ?? DEFAULT_DEBUG_PLUGIN_ERRORS;
    }
    if ("maxPluginErrors" in options) {
      this.options.maxPluginErrors = options.maxPluginErrors ?? DEFAULT_MAX_PLUGIN_ERRORS;
    }
    if ("onPluginError" in options) {
      this.options.onPluginError = options.onPluginError;
    }
  }
  register(plugin) {
    if (this.plugins.some((entry) => entry.plugin.id === plugin.id)) {
      throw new Error(`Plugin with id "${plugin.id}" is already registered`);
    }
    try {
      plugin.setup?.(this.hostContext, this.rendererInstance);
    } catch (error) {
      this.reportPluginError({
        pluginId: plugin.id,
        phase: "setup",
        source: "registry",
        error
      });
      return noop;
    }
    this.plugins.push({
      plugin,
      registrationOrder: this.registrationOrder++,
      cachedOrder: plugin.order ?? 0,
      cachedId: plugin.id
    });
    this.invalidateSortedPluginsCache();
    this.notifyListeners();
    return () => {
      this.unregister(plugin.id);
    };
  }
  unregister(id) {
    const index = this.plugins.findIndex((entry2) => entry2.plugin.id === id);
    if (index === -1) {
      return false;
    }
    const [entry] = this.plugins.splice(index, 1);
    this.invalidateSortedPluginsCache();
    try {
      entry?.plugin.dispose?.();
    } catch (error) {
      this.reportPluginError({
        pluginId: id,
        phase: "dispose",
        source: "registry",
        error
      });
    }
    this.notifyListeners();
    return true;
  }
  updateOrder(id, order) {
    const entry = this.plugins.find((pluginEntry) => pluginEntry.plugin.id === id);
    if (!entry) {
      return false;
    }
    if ((entry.plugin.order ?? 0) === order) {
      return true;
    }
    entry.plugin.order = order;
    entry.cachedOrder = order;
    this.invalidateSortedPluginsCache();
    this.notifyListeners();
    return true;
  }
  clear() {
    if (this.plugins.length === 0) {
      return;
    }
    const plugins = [...this.plugins];
    this.plugins = [];
    this.invalidateSortedPluginsCache();
    for (const entry of plugins) {
      try {
        entry.plugin.dispose?.();
      } catch (error) {
        this.reportPluginError({
          pluginId: entry.plugin.id,
          phase: "dispose",
          source: "registry",
          error
        });
      }
    }
    this.notifyListeners();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  onPluginError(listener) {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }
  batch(run) {
    this.batchDepth += 1;
    try {
      return run();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0 && this.batchedNotify) {
        this.batchedNotify = false;
        this.flushListeners();
      }
    }
  }
  getPluginErrors() {
    return this.pluginErrors;
  }
  clearPluginErrors() {
    this.pluginErrors = [];
  }
  reportPluginError(report) {
    const event = {
      pluginId: report.pluginId,
      slot: report.slot,
      phase: report.phase,
      source: report.source ?? "registry",
      error: normalizeError(report.error),
      timestamp: Date.now()
    };
    this.pluginErrors.push(event);
    if (this.pluginErrors.length > this.options.maxPluginErrors) {
      this.pluginErrors.splice(0, this.pluginErrors.length - this.options.maxPluginErrors);
    }
    if (this.options.debugPluginErrors) {
      const slotLabel = event.slot ? ` slot="${event.slot}"` : "";
      console.debug(
        `[SlotRegistry][PluginError] plugin="${event.pluginId}" phase="${event.phase}" source="${event.source}"${slotLabel}`
      );
      console.debug(event.error);
    }
    for (const listener of this.errorListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in plugin error listener:", error);
      }
    }
    try {
      this.options.onPluginError?.(event);
    } catch (error) {
      console.error("Error in plugin error callback:", error);
    }
    return event;
  }
  resolve(slot) {
    return this.resolveEntries(slot).map((entry) => entry.renderer);
  }
  resolveEntries(slot) {
    const slotRenderers = [];
    for (const entry of this.getSortedPlugins()) {
      const renderer = entry.plugin.slots[slot];
      if (renderer) {
        slotRenderers.push({
          id: entry.plugin.id,
          renderer
        });
      }
    }
    return slotRenderers;
  }
  getSortedPlugins() {
    this.syncPluginSortMetadata();
    if (this.sortedPluginsCache) {
      return this.sortedPluginsCache;
    }
    this.sortedPluginsCache = [...this.plugins].sort((left, right) => {
      const leftOrder = left.cachedOrder;
      const rightOrder = right.cachedOrder;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if (left.registrationOrder !== right.registrationOrder) {
        return left.registrationOrder - right.registrationOrder;
      }
      return left.cachedId.localeCompare(right.cachedId);
    });
    return this.sortedPluginsCache;
  }
  syncPluginSortMetadata() {
    let hasChanges = false;
    for (const entry of this.plugins) {
      const nextOrder = entry.plugin.order ?? 0;
      const nextId = entry.plugin.id;
      if (entry.cachedOrder !== nextOrder || entry.cachedId !== nextId) {
        entry.cachedOrder = nextOrder;
        entry.cachedId = nextId;
        hasChanges = true;
      }
    }
    if (hasChanges) {
      this.invalidateSortedPluginsCache();
    }
  }
  invalidateSortedPluginsCache() {
    this.sortedPluginsCache = null;
  }
  notifyListeners() {
    if (this.batchDepth > 0) {
      this.batchedNotify = true;
      return;
    }
    this.flushListeners();
  }
  flushListeners() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error("Error in slot registry listener:", error);
      }
    }
  }
};
var slotRegistriesByRenderer = /* @__PURE__ */ new WeakMap();
function getSlotRegistryStore(renderer) {
  const existingStore = slotRegistriesByRenderer.get(renderer);
  if (existingStore) {
    return existingStore;
  }
  const createdStore = /* @__PURE__ */ new Map();
  slotRegistriesByRenderer.set(renderer, createdStore);
  renderer.once("destroy", () => {
    for (const registry of createdStore.values()) {
      try {
        registry.clear();
      } catch (error) {
        console.error("Error disposing slot registry:", error);
      }
    }
    createdStore.clear();
    slotRegistriesByRenderer.delete(renderer);
  });
  return createdStore;
}
function createSlotRegistry(renderer, key, context, options = {}) {
  const store = getSlotRegistryStore(renderer);
  const existing = store.get(key);
  if (existing) {
    if (existing.context !== context) {
      throw new Error(
        `createSlotRegistry called with a different context for renderer key "${key}". Reuse the original context object.`
      );
    }
    const typedExisting = existing;
    typedExisting.configure(options);
    return typedExisting;
  }
  const created = new SlotRegistry(renderer, context, options);
  store.set(key, created);
  return created;
}

// src/plugins/core-slot.ts
function isCoreManagedSlot(contribution) {
  return typeof contribution === "object" && contribution !== null && "render" in contribution;
}
function toCorePlugin(plugin) {
  const slots = {};
  for (const [slotName, contribution] of Object.entries(plugin.slots)) {
    const wrappedRenderer = (ctx, data) => {
      if (isCoreManagedSlot(contribution)) {
        return contribution.render(ctx, data);
      }
      return contribution(ctx, data);
    };
    if (isCoreManagedSlot(contribution)) {
      wrappedRenderer.__coreSlotOwnership = "plugin";
      wrappedRenderer.__coreManagedSlot = contribution;
    } else {
      wrappedRenderer.__coreSlotOwnership = "host";
    }
    slots[slotName] = wrappedRenderer;
  }
  return {
    id: plugin.id,
    order: plugin.order,
    setup: plugin.setup,
    dispose: plugin.dispose,
    slots
  };
}
function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? [...value] : [value];
}
function ensureValidNode(node, pluginId, mount) {
  if (!node) {
    throw new Error(`Plugin "${pluginId}" did not return a renderable node`);
  }
  if (typeof node.then === "function") {
    throw new Error(`Plugin "${pluginId}" returned an async value. Core slots require synchronous renderers.`);
  }
  if (!(node instanceof BaseRenderable)) {
    throw new Error(`Plugin "${pluginId}" must return a BaseRenderable`);
  }
  if (node === mount) {
    throw new Error(`Plugin "${pluginId}" returned the slot mount container as its node`);
  }
  if (node.parent && node.parent !== mount) {
    throw new Error(`Plugin "${pluginId}" returned a renderable already attached to another parent`);
  }
}
function createCoreSlotRegistry(renderer, context, options = {}) {
  return createSlotRegistry(
    renderer,
    "core:slot-registry",
    context,
    options
  );
}
function registerCorePlugin(registry, plugin) {
  return registry.register(toCorePlugin(plugin));
}
function resolveCoreSlot(registry, slot) {
  return resolveCoreSlotEntries(registry, slot).map((entry) => {
    return {
      id: entry.id,
      renderer: entry.renderer
    };
  });
}
function resolveCoreSlotEntries(registry, slot) {
  return registry.resolveEntries(slot).map((entry) => {
    const wrappedRenderer = entry.renderer;
    return {
      id: entry.id,
      renderer: (ctx, data) => wrappedRenderer(ctx, data),
      ownership: wrappedRenderer.__coreSlotOwnership ?? "host",
      managedSlot: wrappedRenderer.__coreManagedSlot
    };
  });
}
var SlotRenderable = class extends Renderable {
  _mode;
  _slotRegistry;
  _slotName;
  _data;
  _fallbackOption;
  _pluginFailurePlaceholder;
  _disposed = false;
  _mountedNodes = [];
  _pluginNodes = /* @__PURE__ */ new Map();
  _activePluginIds = /* @__PURE__ */ new Set();
  _fallbackNodes = null;
  _unsubscribe = null;
  constructor(ctx, options) {
    super(ctx, options);
    this._slotRegistry = options.registry;
    this._slotName = options.name;
    this._data = options.data ?? {};
    this._mode = options.mode ?? "append";
    this._fallbackOption = options.fallback;
    this._pluginFailurePlaceholder = options.pluginFailurePlaceholder;
    this._unsubscribe = this._slotRegistry.subscribe(() => this.refresh());
    try {
      this.refresh();
    } catch (error) {
      this._cleanupAll();
      throw error;
    }
  }
  get mode() {
    return this._mode;
  }
  set mode(value) {
    this._mode = value;
    this.refresh();
  }
  get data() {
    return this._data;
  }
  set data(value) {
    this._data = value;
    this.refresh();
  }
  refresh() {
    if (this._disposed) {
      return;
    }
    const allEntries = resolveCoreSlotEntries(this._slotRegistry, this._slotName);
    const activeEntries = this._mode === "single_winner" && allEntries.length > 0 ? [allEntries[0]] : allEntries;
    const nextActivePluginIds = new Set(activeEntries.map((entry) => entry.id));
    const registeredPluginIds = new Set(allEntries.map((entry) => entry.id));
    this._cleanupInactivePluginNodes(nextActivePluginIds, registeredPluginIds);
    for (const entry of activeEntries) {
      let state = this._pluginNodes.get(entry.id);
      const shouldRender = !state || state.ownership === "plugin" && state.nodes.length === 0 || state.dataRef !== this._data;
      if (shouldRender) {
        const previousState = state;
        try {
          const node = entry.renderer(this._slotRegistry.context, this._data);
          ensureValidNode(node, entry.id, this);
          state = {
            nodes: [node],
            ownership: entry.ownership,
            managedSlot: entry.managedSlot ?? state?.managedSlot,
            dataRef: this._data
          };
        } catch (error) {
          const failure = this._slotRegistry.reportPluginError({
            pluginId: entry.id,
            slot: String(this._slotName),
            phase: "render",
            source: "core",
            error
          });
          state = {
            nodes: this._resolvePluginFailurePlaceholder(failure),
            ownership: "host",
            managedSlot: entry.managedSlot ?? state?.managedSlot,
            dataRef: this._data
          };
        }
        if (previousState) {
          this._cleanupReplacedPluginNodes(previousState, state.nodes);
        }
        this._pluginNodes.set(entry.id, state);
      }
      if (!this._activePluginIds.has(entry.id)) {
        const activeState = this._pluginNodes.get(entry.id);
        if (activeState) {
          this._callManagedHook(entry.id, activeState.managedSlot, "onActivate", "setup");
        }
      }
    }
    const desiredNodes = [];
    if (this._mode === "append" || activeEntries.length === 0) {
      desiredNodes.push(...this._ensureFallbackNodes());
    }
    for (const entry of activeEntries) {
      const state = this._pluginNodes.get(entry.id);
      if (state) {
        desiredNodes.push(...state.nodes);
      }
    }
    if (this._mode !== "append" && desiredNodes.length === 0) {
      desiredNodes.push(...this._ensureFallbackNodes());
    }
    this._reconcileMountedNodes(desiredNodes);
    this._activePluginIds = nextActivePluginIds;
  }
  destroySelf() {
    this._cleanupAll();
  }
  _cleanupAll() {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this._unsubscribe?.();
    this._unsubscribe = null;
    for (const [pluginId, state] of this._pluginNodes) {
      if (this._activePluginIds.has(pluginId)) {
        this._callManagedHook(pluginId, state.managedSlot, "onDeactivate", "dispose");
      }
      this._callManagedHook(pluginId, state.managedSlot, "onDispose", "dispose");
      for (const node of state.nodes) {
        this._detachNodeFromMount(node);
      }
      if (state.ownership === "host") {
        for (const node of state.nodes) {
          node.destroyRecursively();
        }
      }
    }
    this._pluginNodes.clear();
    this._activePluginIds = /* @__PURE__ */ new Set();
    if (this._fallbackNodes) {
      for (const node of this._fallbackNodes) {
        node.destroyRecursively();
      }
      this._fallbackNodes = null;
    }
    this._mountedNodes = [];
  }
  _ensureFallbackNodes() {
    if (this._fallbackNodes !== null) {
      return this._fallbackNodes;
    }
    const source = typeof this._fallbackOption === "function" ? this._fallbackOption() : this._fallbackOption;
    const nodes = asArray(source);
    for (const node of nodes) {
      ensureValidNode(node, "fallback", this);
    }
    this._fallbackNodes = nodes;
    return this._fallbackNodes;
  }
  _callManagedHook(pluginId, managedSlot, hook, phase) {
    const callback = managedSlot?.[hook];
    if (!callback) {
      return;
    }
    try {
      callback(this._slotRegistry.context);
    } catch (error) {
      this._slotRegistry.reportPluginError({
        pluginId,
        slot: String(this._slotName),
        phase,
        source: "core",
        error
      });
    }
  }
  _detachNodeFromMount(node) {
    if (node.parent === this) {
      this.remove(node.id);
    }
  }
  _cleanupInactivePluginNodes(nextActivePluginIds, registeredPluginIds) {
    for (const [pluginId, state] of this._pluginNodes) {
      if (nextActivePluginIds.has(pluginId)) {
        continue;
      }
      if (this._activePluginIds.has(pluginId)) {
        this._callManagedHook(pluginId, state.managedSlot, "onDeactivate", "dispose");
      }
      for (const node of state.nodes) {
        this._detachNodeFromMount(node);
      }
      if (!registeredPluginIds.has(pluginId)) {
        this._callManagedHook(pluginId, state.managedSlot, "onDispose", "dispose");
        if (state.ownership === "host") {
          for (const node of state.nodes) {
            node.destroyRecursively();
          }
        }
        this._pluginNodes.delete(pluginId);
        continue;
      }
      if (state.ownership === "host") {
        for (const node of state.nodes) {
          node.destroyRecursively();
        }
        this._pluginNodes.delete(pluginId);
        continue;
      }
      state.nodes = [];
    }
  }
  _cleanupReplacedPluginNodes(previousState, nextNodes) {
    const retainedNodes = new Set(nextNodes);
    for (const node of previousState.nodes) {
      if (retainedNodes.has(node)) {
        continue;
      }
      this._detachNodeFromMount(node);
      if (previousState.ownership === "host") {
        node.destroyRecursively();
      }
    }
  }
  _resolvePluginFailurePlaceholder(failure) {
    if (!this._pluginFailurePlaceholder) {
      return [];
    }
    try {
      const placeholderSource = this._pluginFailurePlaceholder(failure, this._slotRegistry.context);
      const placeholderNodes = asArray(placeholderSource);
      for (const node of placeholderNodes) {
        ensureValidNode(node, `${failure.pluginId}:error-placeholder`, this);
      }
      return placeholderNodes;
    } catch (placeholderError) {
      this._slotRegistry.reportPluginError({
        pluginId: failure.pluginId,
        slot: String(this._slotName),
        phase: "error_placeholder",
        source: "core",
        error: placeholderError
      });
      return [];
    }
  }
  _reconcileMountedNodes(desiredNodes) {
    const desiredNodeSet = new Set(desiredNodes);
    for (const node of this._mountedNodes) {
      if (!desiredNodeSet.has(node)) {
        if (node.parent === this) {
          this.remove(node.id);
        }
      }
    }
    for (let index = 0; index < desiredNodes.length; index++) {
      const node = desiredNodes[index];
      if (node.parent !== this) {
        this.add(node, index);
        continue;
      }
      const childAtIndex = this.getChildren()[index];
      if (childAtIndex?.id !== node.id) {
        this.add(node, index);
      }
    }
    this._mountedNodes = [...desiredNodes];
  }
};

// src/core/audio.ts
import { EventEmitter } from "events";
import { readFile } from "node:fs/promises";
function statusToError(action, status) {
  return new Error(`Audio ${action} failed: ${status}`);
}
function toBytes(data) {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}
var Audio = class _Audio extends EventEmitter {
  static create(options = {}) {
    return new _Audio(resolveRenderLib(), options);
  }
  lib;
  defaultStartOptions;
  engine = null;
  groups = /* @__PURE__ */ new Map();
  playbackStarted = false;
  mixerStarted = false;
  constructor(lib, options) {
    super();
    this.lib = lib;
    this.defaultStartOptions = options.startOptions;
    const createOptions = options.sampleRate == null && options.playbackChannels == null ? void 0 : {
      sampleRate: options.sampleRate == null ? void 0 : Math.max(0, Math.trunc(options.sampleRate)),
      playbackChannels: options.playbackChannels == null ? void 0 : Math.max(0, Math.trunc(options.playbackChannels))
    };
    this.engine = this.lib.createAudioEngine(createOptions);
    if (!this.engine) {
      this.emitError("createAudioEngine", void 0, "Audio createAudioEngine returned null");
      return;
    }
    if (options.autoStart ?? false) {
      this.start(this.defaultStartOptions);
    }
  }
  emitError(action, status, message, cause) {
    const error = message ? new Error(message) : statusToError(action, status ?? -1);
    if (cause) error.cause = cause;
    this.emit("error", error, { action, status });
  }
  start(options) {
    if (this.playbackStarted) return true;
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("start", void 0, "Audio engine unavailable during start");
      return false;
    }
    const startOptions = options ?? this.defaultStartOptions;
    const status = this.lib.audioStart(engine2, startOptions);
    if (status !== 0) {
      this.emitError("start", status);
      return false;
    }
    this.playbackStarted = true;
    this.mixerStarted = true;
    this.emit("started");
    return true;
  }
  startMixer() {
    if (this.mixerStarted) return true;
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("startMixer", void 0, "Audio engine unavailable during startMixer");
      return false;
    }
    const status = this.lib.audioStartMixer(engine2);
    if (status !== 0) {
      this.emitError("startMixer", status);
      return false;
    }
    this.mixerStarted = true;
    this.emit("mixerStarted");
    return true;
  }
  stop() {
    if (!this.mixerStarted) return true;
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("stop", void 0, "Audio engine unavailable during stop");
      return false;
    }
    const status = this.lib.audioStop(engine2);
    if (status !== 0) {
      this.emitError("stop", status);
      return false;
    }
    this.playbackStarted = false;
    this.mixerStarted = false;
    this.emit("stopped");
    return true;
  }
  isStarted() {
    return this.playbackStarted;
  }
  isMixerStarted() {
    return this.mixerStarted;
  }
  loadSound(data) {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("loadSound", void 0, "Audio engine unavailable during loadSound");
      return null;
    }
    const result = this.lib.audioLoad(engine2, toBytes(data));
    if (result.status !== 0 || result.soundId == null) {
      this.emitError("loadSound", result.status);
      return null;
    }
    return result.soundId;
  }
  async loadSoundFile(filePath) {
    const bytes = await readFile(filePath).catch((err) => {
      this.emitError("loadSoundFile", void 0, `Failed to read file '${filePath}': ${err.message}`, err);
      return null;
    });
    if (bytes == null) return null;
    return this.loadSound(bytes);
  }
  unloadSound(sound) {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("unloadSound", void 0, "Audio engine unavailable during unloadSound");
      return false;
    }
    const status = this.lib.audioUnload(engine2, sound);
    if (status !== 0) {
      this.emitError("unloadSound", status);
      return false;
    }
    return true;
  }
  group(name) {
    const existing = this.groups.get(name);
    if (existing != null) {
      return existing;
    }
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("group", void 0, "Audio engine unavailable during group");
      return null;
    }
    const result = this.lib.audioCreateGroup(engine2, name);
    if (result.status !== 0 || result.groupId == null) {
      this.emitError("group", result.status);
      return null;
    }
    this.groups.set(name, result.groupId);
    return result.groupId;
  }
  play(sound, options) {
    const rawOptions = options ? {
      volume: options.volume,
      pan: options.pan,
      loop: options.loop,
      groupId: options.groupId ?? 0
    } : void 0;
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("play", void 0, "Audio engine unavailable during play");
      return null;
    }
    const result = this.lib.audioPlay(engine2, sound, rawOptions);
    if (result.status !== 0 || result.voiceId == null) {
      this.emitError("play", result.status);
      return null;
    }
    return result.voiceId;
  }
  stopVoice(voice) {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("stopVoice", void 0, "Audio engine unavailable during stopVoice");
      return false;
    }
    const status = this.lib.audioStopVoice(engine2, voice);
    if (status !== 0) {
      this.emitError("stopVoice", status);
      return false;
    }
    return true;
  }
  setVoiceGroup(voice, group) {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("setVoiceGroup", void 0, "Audio engine unavailable during setVoiceGroup");
      return false;
    }
    const status = this.lib.audioSetVoiceGroup(engine2, voice, group);
    if (status !== 0) {
      this.emitError("setVoiceGroup", status);
      return false;
    }
    return true;
  }
  setGroupVolume(group, volume) {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("setGroupVolume", void 0, "Audio engine unavailable during setGroupVolume");
      return false;
    }
    const status = this.lib.audioSetGroupVolume(engine2, group, volume);
    if (status !== 0) {
      this.emitError("setGroupVolume", status);
      return false;
    }
    return true;
  }
  setMasterVolume(volume) {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("setMasterVolume", void 0, "Audio engine unavailable during setMasterVolume");
      return false;
    }
    const status = this.lib.audioSetMasterVolume(engine2, volume);
    if (status !== 0) {
      this.emitError("setMasterVolume", status);
      return false;
    }
    return true;
  }
  mixFrames(frameCount, channels = 2) {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("mixFrames", void 0, "Audio engine unavailable during mixFrames");
      return null;
    }
    const output = new Float32Array(frameCount * channels);
    const status = this.lib.audioMixToBuffer(engine2, output, frameCount, channels);
    if (status !== 0) {
      this.emitError("mixFrames", status);
      return null;
    }
    return output;
  }
  enableTap(capacityFrames = 8192) {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("enableTap", void 0, "Audio engine unavailable during enableTap");
      return false;
    }
    const status = this.lib.audioEnableTap(engine2, true, capacityFrames);
    if (status !== 0) {
      this.emitError("enableTap", status);
      return false;
    }
    return true;
  }
  disableTap() {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("enableTap", void 0, "Audio engine unavailable during disableTap");
      return false;
    }
    const status = this.lib.audioEnableTap(engine2, false, 0);
    if (status !== 0) {
      this.emitError("enableTap", status);
      return false;
    }
    return true;
  }
  readTapFrames(frameCount, channels = 2) {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("readTapFrames", void 0, "Audio engine unavailable during readTapFrames");
      return null;
    }
    const output = new Float32Array(frameCount * channels);
    const result = this.lib.audioReadTap(engine2, output, frameCount, channels);
    if (result.status !== 0) {
      this.emitError("readTapFrames", result.status);
      return null;
    }
    return { frames: output, framesRead: result.framesRead };
  }
  listPlaybackDevices() {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("listPlaybackDevices", void 0, "Audio engine unavailable during listPlaybackDevices");
      return null;
    }
    const refreshStatus = this.lib.audioRefreshPlaybackDevices(engine2);
    if (refreshStatus !== 0) {
      this.emitError("listPlaybackDevices", refreshStatus);
      return null;
    }
    const count = this.lib.audioGetPlaybackDeviceCount(engine2);
    const devices = [];
    for (let index = 0; index < count; index += 1) {
      devices.push({
        index,
        name: this.lib.audioGetPlaybackDeviceName(engine2, index),
        isDefault: this.lib.audioIsPlaybackDeviceDefault(engine2, index)
      });
    }
    return devices;
  }
  selectPlaybackDevice(index) {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("selectPlaybackDevice", void 0, "Audio engine unavailable during selectPlaybackDevice");
      return false;
    }
    const refreshStatus = this.lib.audioRefreshPlaybackDevices(engine2);
    if (refreshStatus !== 0) {
      this.emitError("selectPlaybackDevice", refreshStatus);
      return false;
    }
    const status = this.lib.audioSelectPlaybackDevice(engine2, index);
    if (status !== 0) {
      this.emitError("selectPlaybackDevice", status);
      return false;
    }
    return true;
  }
  clearPlaybackDeviceSelection() {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError(
        "clearPlaybackDeviceSelection",
        void 0,
        "Audio engine unavailable during clearPlaybackDeviceSelection"
      );
      return;
    }
    this.lib.audioClearPlaybackDeviceSelection(engine2);
  }
  getStats() {
    const engine2 = this.engine;
    if (!engine2) {
      this.emitError("getStats", void 0, "Audio engine unavailable during getStats");
      return null;
    }
    const stats = this.lib.audioGetStats(engine2);
    if (stats == null) {
      this.emitError("getStats", void 0, "Failed to retrieve audio stats");
    }
    return stats;
  }
  dispose() {
    if (!this.engine) return;
    if (this.mixerStarted) {
      this.stop();
    }
    this.groups.clear();
    this.lib.destroyAudioEngine(this.engine);
    this.engine = null;
    this.emit("disposed");
  }
};
function setupAudio(options = {}) {
  return Audio.create(options);
}

// src/renderables/FrameBuffer.ts
var FrameBufferRenderable = class extends Renderable {
  frameBuffer;
  respectAlpha;
  constructor(ctx, options) {
    super(ctx, options);
    this.respectAlpha = options.respectAlpha || false;
    this.frameBuffer = OptimizedBuffer.create(options.width, options.height, this._ctx.widthMethod, {
      respectAlpha: this.respectAlpha,
      id: options.id || `framebufferrenderable-${this.id}`
    });
  }
  onResize(width, height) {
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid resize dimensions for FrameBufferRenderable ${this.id}: ${width}x${height}`);
    }
    this.frameBuffer.resize(width, height);
    super.onResize(width, height);
    this.requestRender();
  }
  renderSelf(buffer) {
    if (!this.visible || this.isDestroyed) return;
    buffer.drawFrameBuffer(this.x, this.y, this.frameBuffer);
  }
  destroySelf() {
    this.frameBuffer?.destroy();
    super.destroySelf();
  }
};

// src/renderables/ASCIIFont.ts
var ASCIIFontRenderable = class _ASCIIFontRenderable extends FrameBufferRenderable {
  selectable = true;
  static _defaultOptions = {
    text: "",
    font: "tiny",
    color: "#FFFFFF",
    backgroundColor: "transparent",
    selectionBg: void 0,
    selectionFg: void 0,
    selectable: true
  };
  _text;
  _font;
  _color;
  _backgroundColor;
  _selectionBg;
  _selectionFg;
  lastLocalSelection = null;
  selectionHelper;
  constructor(ctx, options) {
    const defaultOptions = _ASCIIFontRenderable._defaultOptions;
    const font = options.font || defaultOptions.font;
    const text = options.text || defaultOptions.text;
    const measurements = measureText({ text, font });
    super(ctx, {
      flexShrink: 0,
      ...options,
      width: measurements.width || 1,
      height: measurements.height || 1,
      respectAlpha: true
    });
    this._text = text;
    this._font = font;
    this._color = options.color || defaultOptions.color;
    this._backgroundColor = options.backgroundColor || defaultOptions.backgroundColor;
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : void 0;
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : void 0;
    this.selectable = options.selectable ?? true;
    this.selectionHelper = new ASCIIFontSelectionHelper(
      () => this._text,
      () => this._font
    );
    this.renderFontToBuffer();
  }
  get text() {
    return this._text;
  }
  set text(value) {
    this._text = value;
    this.updateDimensions();
    if (this.lastLocalSelection) {
      this.selectionHelper.onLocalSelectionChanged(this.lastLocalSelection, this.width, this.height);
    }
    this.renderFontToBuffer();
    this.requestRender();
  }
  get font() {
    return this._font;
  }
  set font(value) {
    this._font = value;
    this.updateDimensions();
    if (this.lastLocalSelection) {
      this.selectionHelper.onLocalSelectionChanged(this.lastLocalSelection, this.width, this.height);
    }
    this.renderFontToBuffer();
    this.requestRender();
  }
  get color() {
    return this._color;
  }
  set color(value) {
    this._color = value;
    this.renderFontToBuffer();
    this.requestRender();
  }
  get backgroundColor() {
    return this._backgroundColor;
  }
  set backgroundColor(value) {
    this._backgroundColor = value;
    this.renderFontToBuffer();
    this.requestRender();
  }
  updateDimensions() {
    const measurements = measureText({ text: this._text, font: this._font });
    this.width = measurements.width;
    this.height = measurements.height;
  }
  shouldStartSelection(x, y) {
    const localX = x - this.x;
    const localY = y - this.y;
    return this.selectionHelper.shouldStartSelection(localX, localY, this.width, this.height);
  }
  onSelectionChanged(selection) {
    const localSelection = convertGlobalToLocalSelection(selection, this.x, this.y);
    this.lastLocalSelection = localSelection;
    const changed = this.selectionHelper.onLocalSelectionChanged(localSelection, this.width, this.height);
    if (changed) {
      this.renderFontToBuffer();
      this.requestRender();
    }
    return changed;
  }
  getSelectedText() {
    const selection = this.selectionHelper.getSelection();
    if (!selection) return "";
    return this._text.slice(selection.start, selection.end);
  }
  hasSelection() {
    return this.selectionHelper.hasSelection();
  }
  onResize(width, height) {
    super.onResize(width, height);
    this.renderFontToBuffer();
  }
  renderFontToBuffer() {
    if (this.isDestroyed) return;
    this.frameBuffer.clear(parseColor(this._backgroundColor));
    renderFontToFrameBuffer(this.frameBuffer, {
      text: this._text,
      x: 0,
      y: 0,
      color: this.color,
      backgroundColor: this._backgroundColor,
      font: this._font
    });
    const selection = this.selectionHelper.getSelection();
    if (selection && (this._selectionBg || this._selectionFg)) {
      this.renderSelectionHighlight(selection);
    }
  }
  renderSelectionHighlight(selection) {
    if (!this._selectionBg && !this._selectionFg) return;
    const selectedText = this._text.slice(selection.start, selection.end);
    if (!selectedText) return;
    const positions = getCharacterPositions(this._text, this._font);
    const startX = positions[selection.start] || 0;
    const endX = selection.end < positions.length ? positions[selection.end] : measureText({ text: this._text, font: this._font }).width;
    if (this._selectionBg) {
      this.frameBuffer.fillRect(startX, 0, endX - startX, this.height, parseColor(this._selectionBg));
    }
    if (this._selectionFg || this._selectionBg) {
      renderFontToFrameBuffer(this.frameBuffer, {
        text: selectedText,
        x: startX,
        y: 0,
        color: this._selectionFg ? this._selectionFg : this._color,
        backgroundColor: this._selectionBg ? this._selectionBg : this._backgroundColor,
        font: this._font
      });
    }
  }
};

// src/renderables/composition/constructs.ts
function Generic(props, ...children) {
  return h(VRenderable, props || {}, ...children);
}
function Box(props, ...children) {
  return h(BoxRenderable, props || {}, ...children);
}
function Text(props, ...children) {
  return h(TextRenderable, props || {}, ...children);
}
function ASCIIFont(props, ...children) {
  return h(ASCIIFontRenderable, props || {}, ...children);
}
function Input(props, ...children) {
  return h(InputRenderable, props || {}, ...children);
}
function Select(props, ...children) {
  return h(SelectRenderable, props || {}, ...children);
}
function TabSelect(props, ...children) {
  return h(TabSelectRenderable, props || {}, ...children);
}
function FrameBuffer(props, ...children) {
  return h(FrameBufferRenderable, props, ...children);
}
function Code(props, ...children) {
  return h(CodeRenderable, props, ...children);
}
function ScrollBox(props, ...children) {
  return h(ScrollBoxRenderable, props || {}, ...children);
}
function StyledText2(props, ...children) {
  const styledProps = props;
  const textNodeOptions = {
    ...styledProps,
    attributes: styledProps?.attributes ?? 0
  };
  const textNode = new TextNodeRenderable(textNodeOptions);
  for (const child of children) {
    textNode.add(child);
  }
  return textNode;
}
var vstyles = {
  // Basic text styles
  bold: (...children) => StyledText2({ attributes: TextAttributes.BOLD }, ...children),
  italic: (...children) => StyledText2({ attributes: TextAttributes.ITALIC }, ...children),
  underline: (...children) => StyledText2({ attributes: TextAttributes.UNDERLINE }, ...children),
  dim: (...children) => StyledText2({ attributes: TextAttributes.DIM }, ...children),
  blink: (...children) => StyledText2({ attributes: TextAttributes.BLINK }, ...children),
  inverse: (...children) => StyledText2({ attributes: TextAttributes.INVERSE }, ...children),
  hidden: (...children) => StyledText2({ attributes: TextAttributes.HIDDEN }, ...children),
  strikethrough: (...children) => StyledText2({ attributes: TextAttributes.STRIKETHROUGH }, ...children),
  // Combined styles
  boldItalic: (...children) => StyledText2({ attributes: TextAttributes.BOLD | TextAttributes.ITALIC }, ...children),
  boldUnderline: (...children) => StyledText2({ attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE }, ...children),
  italicUnderline: (...children) => StyledText2({ attributes: TextAttributes.ITALIC | TextAttributes.UNDERLINE }, ...children),
  boldItalicUnderline: (...children) => StyledText2({ attributes: TextAttributes.BOLD | TextAttributes.ITALIC | TextAttributes.UNDERLINE }, ...children),
  // Color helpers
  color: (color, ...children) => StyledText2({ fg: color }, ...children),
  bgColor: (bgColor, ...children) => StyledText2({ bg: bgColor }, ...children),
  fg: (color, ...children) => StyledText2({ fg: color }, ...children),
  bg: (bgColor, ...children) => StyledText2({ bg: bgColor }, ...children),
  // Custom styling function
  styled: (attributes = 0, ...children) => StyledText2({ attributes }, ...children)
};

// src/renderables/composition/v-renderable.ts
var VRenderable = class extends Renderable {
  options;
  constructor(ctx, options) {
    super(ctx, options);
    this.options = options;
  }
  renderSelf(buffer, deltaTime) {
    if (this.options.render) {
      this.options.render.call(this.options, buffer, deltaTime, this);
    }
  }
};

// src/renderables/LineNumberRenderable.ts
var DEFAULT_GUTTER_FG = "#888888";
var DEFAULT_GUTTER_BG = "transparent";
var GutterRenderable = class extends Renderable {
  target;
  _fg;
  _bg;
  _minWidth;
  _paddingRight;
  _lineColorsGutter;
  _lineColorsContent;
  _lineSigns;
  _lineNumberOffset;
  _hideLineNumbers;
  _lineNumbers;
  _maxBeforeWidth = 0;
  _maxAfterWidth = 0;
  _lastKnownLineCount = 0;
  _lastKnownScrollY = 0;
  constructor(ctx, target, options) {
    super(ctx, {
      id: options.id,
      width: "auto",
      height: "auto",
      flexGrow: 0,
      flexShrink: 0,
      buffered: options.buffered
    });
    this.target = target;
    this._fg = options.fg;
    this._bg = options.bg;
    this._minWidth = options.minWidth;
    this._paddingRight = options.paddingRight;
    this._lineColorsGutter = options.lineColorsGutter;
    this._lineColorsContent = options.lineColorsContent;
    this._lineSigns = options.lineSigns;
    this._lineNumberOffset = options.lineNumberOffset;
    this._hideLineNumbers = options.hideLineNumbers;
    this._lineNumbers = options.lineNumbers ?? /* @__PURE__ */ new Map();
    this._lastKnownLineCount = this.target.virtualLineCount;
    this._lastKnownScrollY = this.target.scrollY;
    this.calculateSignWidths();
    this.setupMeasureFunc();
    this.onLifecyclePass = () => {
      const currentLineCount = this.target.virtualLineCount;
      if (currentLineCount !== this._lastKnownLineCount) {
        this._lastKnownLineCount = currentLineCount;
        this.yogaNode.markDirty();
        this.requestRender();
      }
    };
  }
  setupMeasureFunc() {
    const measureFunc = (width, widthMode, height, heightMode) => {
      const gutterWidth = this.calculateWidth();
      const gutterHeight = this.target.virtualLineCount;
      return {
        width: gutterWidth,
        height: gutterHeight
      };
    };
    this.yogaNode.setMeasureFunc(measureFunc);
  }
  remeasure() {
    this.yogaNode.markDirty();
  }
  setLineNumberOffset(offset) {
    if (this._lineNumberOffset !== offset) {
      this._lineNumberOffset = offset;
      this.yogaNode.markDirty();
      this.requestRender();
    }
  }
  setHideLineNumbers(hideLineNumbers) {
    this._hideLineNumbers = hideLineNumbers;
    this.yogaNode.markDirty();
    this.requestRender();
  }
  setLineNumbers(lineNumbers) {
    this._lineNumbers = lineNumbers;
    this.yogaNode.markDirty();
    this.requestRender();
  }
  calculateSignWidths() {
    this._maxBeforeWidth = 0;
    this._maxAfterWidth = 0;
    for (const sign of this._lineSigns.values()) {
      if (sign.before) {
        const width = stringWidth(sign.before);
        this._maxBeforeWidth = Math.max(this._maxBeforeWidth, width);
      }
      if (sign.after) {
        const width = stringWidth(sign.after);
        this._maxAfterWidth = Math.max(this._maxAfterWidth, width);
      }
    }
  }
  calculateWidth() {
    const totalLines = this.target.virtualLineCount;
    let maxLineNumber = totalLines + this._lineNumberOffset;
    if (this._lineNumbers.size > 0) {
      for (const customLineNum of this._lineNumbers.values()) {
        maxLineNumber = Math.max(maxLineNumber, customLineNum);
      }
    }
    const digits = maxLineNumber > 0 ? Math.floor(Math.log10(maxLineNumber)) + 1 : 1;
    const baseWidth = Math.max(this._minWidth, digits + this._paddingRight + 1);
    return baseWidth + this._maxBeforeWidth + this._maxAfterWidth;
  }
  setLineColors(lineColorsGutter, lineColorsContent) {
    this._lineColorsGutter = lineColorsGutter;
    this._lineColorsContent = lineColorsContent;
    this.requestRender();
  }
  get fg() {
    return this._fg;
  }
  setFg(fg2) {
    if (this._fg !== fg2) {
      this._fg = fg2;
      this.requestRender();
    }
  }
  get bg() {
    return this._bg;
  }
  setBg(bg2) {
    if (this._bg !== bg2) {
      this._bg = bg2;
      this.requestRender();
    }
  }
  getLineColors() {
    return {
      gutter: this._lineColorsGutter,
      content: this._lineColorsContent
    };
  }
  setLineSigns(lineSigns) {
    const oldMaxBefore = this._maxBeforeWidth;
    const oldMaxAfter = this._maxAfterWidth;
    this._lineSigns = lineSigns;
    this.calculateSignWidths();
    if (this._maxBeforeWidth !== oldMaxBefore || this._maxAfterWidth !== oldMaxAfter) {
      this.yogaNode.markDirty();
    }
    this.requestRender();
  }
  getLineSigns() {
    return this._lineSigns;
  }
  renderSelf(buffer) {
    const currentScrollY = this.target.scrollY;
    const scrollChanged = currentScrollY !== this._lastKnownScrollY;
    if (this.buffered && !this.isDirty && !scrollChanged) {
      return;
    }
    this._lastKnownScrollY = currentScrollY;
    this.refreshFrameBuffer(buffer);
  }
  refreshFrameBuffer(buffer) {
    const startX = this.buffered ? 0 : this.x;
    const startY = this.buffered ? 0 : this.y;
    if (this.buffered) {
      buffer.clear(this._bg);
    } else if (this._bg.a > 0) {
      buffer.fillRect(startX, startY, this.width, this.height, this._bg);
    }
    const lineInfo = this.target.lineInfo;
    if (!lineInfo || !lineInfo.lineSources) return;
    const sources = lineInfo.lineSources;
    let lastSource = -1;
    const startLine = this.target.scrollY;
    if (startLine >= sources.length) return;
    lastSource = startLine > 0 ? sources[startLine - 1] : -1;
    for (let i = 0; i < this.height; i++) {
      const visualLineIndex = startLine + i;
      if (visualLineIndex >= sources.length) break;
      const logicalLine = sources[visualLineIndex];
      const lineBg = this._lineColorsGutter.get(logicalLine) ?? this._bg;
      if (lineBg !== this._bg) {
        buffer.fillRect(startX, startY + i, this.width, 1, lineBg);
      }
      if (logicalLine === lastSource) {
      } else {
        let currentX = startX;
        const sign = this._lineSigns.get(logicalLine);
        if (sign?.before) {
          const beforeWidth = stringWidth(sign.before);
          const padding = this._maxBeforeWidth - beforeWidth;
          currentX += padding;
          const beforeColor = sign.beforeColor ? parseColor(sign.beforeColor) : this._fg;
          buffer.drawText(sign.before, currentX, startY + i, beforeColor, lineBg);
          currentX += beforeWidth;
        } else if (this._maxBeforeWidth > 0) {
          currentX += this._maxBeforeWidth;
        }
        if (!this._hideLineNumbers.has(logicalLine)) {
          const customLineNum = this._lineNumbers.get(logicalLine);
          const lineNum = customLineNum !== void 0 ? customLineNum : logicalLine + 1 + this._lineNumberOffset;
          const lineNumStr = lineNum.toString();
          const lineNumWidth = lineNumStr.length;
          const availableSpace = this.width - this._maxBeforeWidth - this._maxAfterWidth - this._paddingRight;
          const lineNumX = startX + this._maxBeforeWidth + 1 + availableSpace - lineNumWidth - 1;
          if (lineNumX >= startX + this._maxBeforeWidth + 1) {
            buffer.drawText(lineNumStr, lineNumX, startY + i, this._fg, lineBg);
          }
        }
        if (sign?.after) {
          const afterX = startX + this.width - this._paddingRight - this._maxAfterWidth;
          const afterColor = sign.afterColor ? parseColor(sign.afterColor) : this._fg;
          buffer.drawText(sign.after, afterX, startY + i, afterColor, lineBg);
        }
      }
      lastSource = logicalLine;
    }
  }
};
function darkenColor(color) {
  return RGBA.fromValues(color.r * 0.8, color.g * 0.8, color.b * 0.8, color.a);
}
var LineNumberRenderable = class extends Renderable {
  gutter = null;
  target = null;
  _lineColorsGutter;
  _lineColorsContent;
  _lineSigns;
  _fg;
  _bg;
  _minWidth;
  _paddingRight;
  _lineNumberOffset;
  _hideLineNumbers;
  _lineNumbers;
  _isDestroying = false;
  handleLineInfoChange = () => {
    this.gutter?.remeasure();
    this.requestRender();
  };
  parseLineColor(line, color) {
    if (typeof color === "object" && "gutter" in color) {
      const config = color;
      if (config.gutter) {
        this._lineColorsGutter.set(line, parseColor(config.gutter));
      }
      if (config.content) {
        this._lineColorsContent.set(line, parseColor(config.content));
      } else if (config.gutter) {
        this._lineColorsContent.set(line, darkenColor(parseColor(config.gutter)));
      }
    } else {
      const parsedColor = parseColor(color);
      this._lineColorsGutter.set(line, parsedColor);
      this._lineColorsContent.set(line, darkenColor(parsedColor));
    }
  }
  constructor(ctx, options) {
    super(ctx, {
      ...options,
      flexDirection: "row",
      // CRITICAL:
      // By forcing height=auto, we ensure the parent box properly accounts for our full height.
      height: "auto"
    });
    this._fg = parseColor(options.fg ?? DEFAULT_GUTTER_FG);
    this._bg = parseColor(options.bg ?? DEFAULT_GUTTER_BG);
    this._minWidth = options.minWidth ?? 3;
    this._paddingRight = options.paddingRight ?? 1;
    this._lineNumberOffset = options.lineNumberOffset ?? 0;
    this._hideLineNumbers = options.hideLineNumbers ?? /* @__PURE__ */ new Set();
    this._lineNumbers = options.lineNumbers ?? /* @__PURE__ */ new Map();
    this._lineColorsGutter = /* @__PURE__ */ new Map();
    this._lineColorsContent = /* @__PURE__ */ new Map();
    if (options.lineColors) {
      for (const [line, color] of options.lineColors) {
        this.parseLineColor(line, color);
      }
    }
    this._lineSigns = /* @__PURE__ */ new Map();
    if (options.lineSigns) {
      for (const [line, sign] of options.lineSigns) {
        this._lineSigns.set(line, sign);
      }
    }
    if (options.target) {
      this.setTarget(options.target);
    }
  }
  setTarget(target) {
    if (this.target === target) return;
    if (this.target) {
      this.target.off("line-info-change", this.handleLineInfoChange);
      super.remove(this.target.id);
    }
    if (this.gutter) {
      super.remove(this.gutter.id);
      this.gutter = null;
    }
    this.target = target;
    this.target.on("line-info-change", this.handleLineInfoChange);
    this.gutter = new GutterRenderable(this.ctx, this.target, {
      fg: this._fg,
      bg: this._bg,
      minWidth: this._minWidth,
      paddingRight: this._paddingRight,
      lineColorsGutter: this._lineColorsGutter,
      lineColorsContent: this._lineColorsContent,
      lineSigns: this._lineSigns,
      lineNumberOffset: this._lineNumberOffset,
      hideLineNumbers: this._hideLineNumbers,
      lineNumbers: this._lineNumbers,
      id: this.id ? `${this.id}-gutter` : void 0,
      buffered: true
    });
    super.add(this.gutter);
    super.add(this.target);
  }
  // Override add to intercept and set as target if it's a LineInfoProvider
  add(child) {
    if (!this.target && "lineInfo" in child && "lineCount" in child && "virtualLineCount" in child && "scrollY" in child) {
      this.setTarget(child);
      return this.getChildrenCount() - 1;
    }
    return -1;
  }
  // Override remove to prevent removing gutter/target directly
  remove(id) {
    if (this._isDestroying) {
      super.remove(id);
      return;
    }
    if (this.gutter && id === this.gutter.id) {
      throw new Error("LineNumberRenderable: Cannot remove gutter directly.");
    }
    if (this.target && id === this.target.id) {
      this.clearTarget();
      return;
    }
    super.remove(id);
  }
  // Override destroyRecursively to properly clean up internal components
  destroyRecursively() {
    this._isDestroying = true;
    if (this.target) {
      this.target.off("line-info-change", this.handleLineInfoChange);
    }
    super.destroyRecursively();
    this.gutter = null;
    this.target = null;
  }
  clearTarget() {
    if (this.target) {
      this.target.off("line-info-change", this.handleLineInfoChange);
      super.remove(this.target.id);
      this.target = null;
    }
    if (this.gutter) {
      super.remove(this.gutter.id);
      this.gutter = null;
    }
  }
  renderSelf(buffer) {
    if (!this.target || !this.gutter) return;
    const lineInfo = this.target.lineInfo;
    if (!lineInfo || !lineInfo.lineSources) return;
    const sources = lineInfo.lineSources;
    const startLine = this.target.scrollY;
    if (startLine >= sources.length) return;
    const gutterWidth = this.gutter.visible ? this.gutter.width : 0;
    const contentWidth = this.width - gutterWidth;
    for (let i = 0; i < this.height; i++) {
      const visualLineIndex = startLine + i;
      if (visualLineIndex >= sources.length) break;
      const logicalLine = sources[visualLineIndex];
      const lineBg = this._lineColorsContent.get(logicalLine);
      if (lineBg) {
        buffer.fillRect(this.x + gutterWidth, this.y + i, contentWidth, 1, lineBg);
      }
    }
  }
  set showLineNumbers(value) {
    if (this.gutter) {
      this.gutter.visible = value;
    }
  }
  get showLineNumbers() {
    return this.gutter?.visible ?? false;
  }
  get fg() {
    return this._fg;
  }
  set fg(value) {
    const parsed = parseColor(value ?? DEFAULT_GUTTER_FG);
    if (this._fg !== parsed) {
      this._fg = parsed;
      this.gutter?.setFg(parsed);
    }
  }
  get bg() {
    return this._bg;
  }
  set bg(value) {
    const parsed = parseColor(value ?? DEFAULT_GUTTER_BG);
    if (this._bg !== parsed) {
      this._bg = parsed;
      this.gutter?.setBg(parsed);
    }
  }
  setLineColor(line, color) {
    this.parseLineColor(line, color);
    if (this.gutter) {
      this.gutter.setLineColors(this._lineColorsGutter, this._lineColorsContent);
    }
  }
  clearLineColor(line) {
    this._lineColorsGutter.delete(line);
    this._lineColorsContent.delete(line);
    if (this.gutter) {
      this.gutter.setLineColors(this._lineColorsGutter, this._lineColorsContent);
    }
  }
  clearAllLineColors() {
    this._lineColorsGutter.clear();
    this._lineColorsContent.clear();
    if (this.gutter) {
      this.gutter.setLineColors(this._lineColorsGutter, this._lineColorsContent);
    }
  }
  setLineColors(lineColors) {
    this._lineColorsGutter.clear();
    this._lineColorsContent.clear();
    for (const [line, color] of lineColors) {
      this.parseLineColor(line, color);
    }
    if (this.gutter) {
      this.gutter.setLineColors(this._lineColorsGutter, this._lineColorsContent);
    }
  }
  getLineColors() {
    return {
      gutter: this._lineColorsGutter,
      content: this._lineColorsContent
    };
  }
  setLineSign(line, sign) {
    this._lineSigns.set(line, sign);
    if (this.gutter) {
      this.gutter.setLineSigns(this._lineSigns);
    }
  }
  clearLineSign(line) {
    this._lineSigns.delete(line);
    if (this.gutter) {
      this.gutter.setLineSigns(this._lineSigns);
    }
  }
  clearAllLineSigns() {
    this._lineSigns.clear();
    if (this.gutter) {
      this.gutter.setLineSigns(this._lineSigns);
    }
  }
  setLineSigns(lineSigns) {
    this._lineSigns.clear();
    for (const [line, sign] of lineSigns) {
      this._lineSigns.set(line, sign);
    }
    if (this.gutter) {
      this.gutter.setLineSigns(this._lineSigns);
    }
  }
  getLineSigns() {
    return this._lineSigns;
  }
  set lineNumberOffset(value) {
    if (this._lineNumberOffset !== value) {
      this._lineNumberOffset = value;
      if (this.gutter) {
        this.gutter.setLineNumberOffset(value);
      }
    }
  }
  get lineNumberOffset() {
    return this._lineNumberOffset;
  }
  setHideLineNumbers(hideLineNumbers) {
    this._hideLineNumbers = hideLineNumbers;
    if (this.gutter) {
      this.gutter.setHideLineNumbers(hideLineNumbers);
    }
  }
  getHideLineNumbers() {
    return this._hideLineNumbers;
  }
  setLineNumbers(lineNumbers) {
    this._lineNumbers = lineNumbers;
    if (this.gutter) {
      this.gutter.setLineNumbers(lineNumbers);
    }
  }
  getLineNumbers() {
    return this._lineNumbers;
  }
  highlightLines(startLine, endLine, color) {
    for (let i = startLine; i <= endLine; i++) {
      this.parseLineColor(i, color);
    }
    if (this.gutter) {
      this.gutter.setLineColors(this._lineColorsGutter, this._lineColorsContent);
    }
  }
  clearHighlightLines(startLine, endLine) {
    for (let i = startLine; i <= endLine; i++) {
      this._lineColorsGutter.delete(i);
      this._lineColorsContent.delete(i);
    }
    if (this.gutter) {
      this.gutter.setLineColors(this._lineColorsGutter, this._lineColorsContent);
    }
  }
};

// src/renderables/Diff.ts
import { parsePatch } from "diff";
var DiffRenderable = class extends Renderable {
  _diff;
  _syncScroll = false;
  _view;
  _parsedDiff = null;
  _parseError = null;
  // Source-line anchors for hunk starts; native extmarks should eventually own these anchors.
  _hunkStartLines = [];
  _hunkRowOffsets = null;
  // CodeRenderable options
  _fg;
  _filetype;
  _syntaxStyle;
  _wrapMode;
  _conceal;
  _selectionBg;
  _selectionFg;
  _treeSitterClient;
  // LineNumberRenderable options
  _showLineNumbers;
  _lineNumberFg;
  _lineNumberBg;
  // Diff styling
  _addedBg;
  _removedBg;
  _contextBg;
  _addedContentBg;
  _removedContentBg;
  _contextContentBg;
  _addedSignColor;
  _removedSignColor;
  _addedLineNumberBg;
  _removedLineNumberBg;
  leftSide = null;
  rightSide = null;
  leftSideAdded = false;
  rightSideAdded = false;
  leftCodeRenderable = null;
  rightCodeRenderable = null;
  pendingRebuild = false;
  _lastWidth = 0;
  errorTextRenderable = null;
  errorCodeRenderable = null;
  _waitingForHighlight = false;
  _lineInfoChangeHandler = null;
  constructor(ctx, options) {
    super(ctx, {
      ...options,
      flexDirection: options.view === "split" ? "row" : "column"
    });
    this._diff = options.diff ?? "";
    this._syncScroll = options.syncScroll ?? false;
    this._view = options.view ?? "unified";
    this._fg = options.fg ? parseColor(options.fg) : void 0;
    this._filetype = options.filetype;
    this._syntaxStyle = options.syntaxStyle;
    this._wrapMode = options.wrapMode;
    this._conceal = options.conceal ?? false;
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : void 0;
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : void 0;
    this._treeSitterClient = options.treeSitterClient;
    this._showLineNumbers = options.showLineNumbers ?? true;
    this._lineNumberFg = parseColor(options.lineNumberFg ?? "#888888");
    this._lineNumberBg = parseColor(options.lineNumberBg ?? "transparent");
    this._addedBg = parseColor(options.addedBg ?? "#1a4d1a");
    this._removedBg = parseColor(options.removedBg ?? "#4d1a1a");
    this._contextBg = parseColor(options.contextBg ?? "transparent");
    this._addedContentBg = options.addedContentBg ? parseColor(options.addedContentBg) : null;
    this._removedContentBg = options.removedContentBg ? parseColor(options.removedContentBg) : null;
    this._contextContentBg = options.contextContentBg ? parseColor(options.contextContentBg) : null;
    this._addedSignColor = parseColor(options.addedSignColor ?? "#22c55e");
    this._removedSignColor = parseColor(options.removedSignColor ?? "#ef4444");
    this._addedLineNumberBg = parseColor(options.addedLineNumberBg ?? "transparent");
    this._removedLineNumberBg = parseColor(options.removedLineNumberBg ?? "transparent");
    if (this._diff) {
      this.parseDiff();
      this.buildView();
    }
  }
  parseDiff() {
    if (!this._diff) {
      this._parsedDiff = null;
      this._parseError = null;
      return;
    }
    try {
      const patches = parsePatch(this._diff);
      if (patches.length === 0) {
        this._parsedDiff = null;
        this._parseError = null;
        return;
      }
      this._parsedDiff = patches[0];
      this._parseError = null;
    } catch (error) {
      this._parsedDiff = null;
      this._parseError = error instanceof Error ? error : new Error(String(error));
    }
  }
  buildView() {
    this._hunkStartLines = [];
    this.invalidateHunkRowOffsets();
    if (this._parseError) {
      this.buildErrorView();
      return;
    }
    if (!this._parsedDiff || this._parsedDiff.hunks.length === 0) {
      this.clearViewRenderables();
      return;
    }
    if (this._view === "unified") {
      this.buildUnifiedView();
    } else {
      this.buildSplitView();
    }
  }
  onMouseEvent(event) {
    if (event.type !== "scroll" || this._view !== "split" || !this._syncScroll) return;
    if (!this.leftCodeRenderable || !this.rightCodeRenderable) return;
    if (!event.target) return;
    if (this.isInsideSide(event.target, "left")) {
      this.rightCodeRenderable.scrollY = this.leftCodeRenderable.scrollY;
      this.rightCodeRenderable.scrollX = this.leftCodeRenderable.scrollX;
    } else if (this.isInsideSide(event.target, "right")) {
      this.leftCodeRenderable.scrollY = this.rightCodeRenderable.scrollY;
      this.leftCodeRenderable.scrollX = this.rightCodeRenderable.scrollX;
    }
  }
  isInsideSide(target, side) {
    const container = side === "left" ? this.leftCodeRenderable : this.rightCodeRenderable;
    let current = target;
    while (current) {
      if (current === container) return true;
      current = current.parent;
    }
    return false;
  }
  onResize(width, height) {
    super.onResize(width, height);
    if (this._view === "split" && this._wrapMode !== "none" && this._wrapMode !== void 0) {
      if (this._lastWidth !== width) {
        this._lastWidth = width;
        this.requestRebuild();
      }
    }
  }
  requestRebuild() {
    if (this.pendingRebuild) {
      return;
    }
    this.pendingRebuild = true;
    queueMicrotask(() => {
      if (!this.isDestroyed && this.pendingRebuild) {
        this.pendingRebuild = false;
        this.buildView();
        this.requestRender();
      }
    });
  }
  invalidateHunkRowOffsets() {
    this._hunkRowOffsets = null;
  }
  rebuildView() {
    if (this._view === "split") {
      this.requestRebuild();
    } else {
      this.buildView();
    }
  }
  handleLineInfoChange = () => {
    this.invalidateHunkRowOffsets();
    if (!this._waitingForHighlight) return;
    if (!this.leftCodeRenderable || !this.rightCodeRenderable) return;
    const leftIsHighlighting = this.leftCodeRenderable.isHighlighting;
    const rightIsHighlighting = this.rightCodeRenderable.isHighlighting;
    if (!leftIsHighlighting && !rightIsHighlighting) {
      this._waitingForHighlight = false;
      this.requestRebuild();
    }
  };
  attachLineInfoListeners() {
    if (!this.leftCodeRenderable && !this.rightCodeRenderable) return;
    this._lineInfoChangeHandler ??= this.handleLineInfoChange;
    if (this.leftCodeRenderable) {
      this.leftCodeRenderable.off("line-info-change", this._lineInfoChangeHandler);
      this.leftCodeRenderable.on("line-info-change", this._lineInfoChangeHandler);
    }
    if (this.rightCodeRenderable) {
      this.rightCodeRenderable.off("line-info-change", this._lineInfoChangeHandler);
      this.rightCodeRenderable.on("line-info-change", this._lineInfoChangeHandler);
    }
  }
  detachLineInfoListeners() {
    if (!this._lineInfoChangeHandler) return;
    if (this.leftCodeRenderable) {
      this.leftCodeRenderable.off("line-info-change", this._lineInfoChangeHandler);
    }
    if (this.rightCodeRenderable) {
      this.rightCodeRenderable.off("line-info-change", this._lineInfoChangeHandler);
    }
    this._lineInfoChangeHandler = null;
  }
  destroyRecursively() {
    this.detachLineInfoListeners();
    this.pendingRebuild = false;
    this.leftSideAdded = false;
    this.rightSideAdded = false;
    super.destroyRecursively();
  }
  buildErrorView() {
    this.flexDirection = "column";
    if (this.leftSide && this.leftSideAdded) {
      super.remove(this.leftSide.id);
      this.leftSideAdded = false;
    }
    if (this.rightSide && this.rightSideAdded) {
      super.remove(this.rightSide.id);
      this.rightSideAdded = false;
    }
    const errorMessage = `Error parsing diff: ${this._parseError?.message || "Unknown error"}
`;
    if (!this.errorTextRenderable) {
      this.errorTextRenderable = new TextRenderable(this.ctx, {
        id: this.id ? `${this.id}-error-text` : void 0,
        content: errorMessage,
        fg: "#ef4444",
        width: "100%",
        flexShrink: 0
      });
      super.add(this.errorTextRenderable);
    } else {
      this.errorTextRenderable.content = errorMessage;
      const errorTextIndex = this.getChildren().indexOf(this.errorTextRenderable);
      if (errorTextIndex === -1) {
        super.add(this.errorTextRenderable);
      }
    }
    if (!this.errorCodeRenderable) {
      this.errorCodeRenderable = new CodeRenderable(this.ctx, {
        id: this.id ? `${this.id}-error-code` : void 0,
        content: this._diff,
        filetype: "diff",
        syntaxStyle: this._syntaxStyle ?? SyntaxStyle.create(),
        wrapMode: this._wrapMode,
        conceal: this._conceal,
        width: "100%",
        flexGrow: 1,
        flexShrink: 1,
        ...this._treeSitterClient !== void 0 && { treeSitterClient: this._treeSitterClient }
      });
      super.add(this.errorCodeRenderable);
    } else {
      this.errorCodeRenderable.content = this._diff;
      this.errorCodeRenderable.wrapMode = this._wrapMode ?? "none";
      if (this._syntaxStyle) {
        this.errorCodeRenderable.syntaxStyle = this._syntaxStyle;
      }
      const errorCodeIndex = this.getChildren().indexOf(this.errorCodeRenderable);
      if (errorCodeIndex === -1) {
        super.add(this.errorCodeRenderable);
      }
    }
  }
  createOrUpdateCodeRenderable(side, content, wrapMode, drawUnstyledText) {
    const existingRenderable = side === "left" ? this.leftCodeRenderable : this.rightCodeRenderable;
    if (!existingRenderable) {
      const codeOptions = {
        id: this.id ? `${this.id}-${side}-code` : void 0,
        content,
        filetype: this._filetype,
        wrapMode,
        conceal: this._conceal,
        syntaxStyle: this._syntaxStyle ?? SyntaxStyle.create(),
        width: "100%",
        height: "100%",
        ...this._fg !== void 0 && { fg: this._fg },
        ...drawUnstyledText !== void 0 && { drawUnstyledText },
        ...this._selectionBg !== void 0 && { selectionBg: this._selectionBg },
        ...this._selectionFg !== void 0 && { selectionFg: this._selectionFg },
        ...this._treeSitterClient !== void 0 && { treeSitterClient: this._treeSitterClient }
      };
      const newRenderable = new CodeRenderable(this.ctx, codeOptions);
      if (side === "left") {
        this.leftCodeRenderable = newRenderable;
      } else {
        this.rightCodeRenderable = newRenderable;
      }
      return newRenderable;
    } else {
      existingRenderable.content = content;
      existingRenderable.wrapMode = wrapMode ?? "none";
      existingRenderable.conceal = this._conceal;
      if (drawUnstyledText !== void 0) {
        existingRenderable.drawUnstyledText = drawUnstyledText;
      }
      if (this._filetype !== void 0) {
        existingRenderable.filetype = this._filetype;
      }
      if (this._syntaxStyle !== void 0) {
        existingRenderable.syntaxStyle = this._syntaxStyle;
      }
      if (this._selectionBg !== void 0) {
        existingRenderable.selectionBg = this._selectionBg;
      }
      if (this._selectionFg !== void 0) {
        existingRenderable.selectionFg = this._selectionFg;
      }
      if (this._fg !== void 0) {
        existingRenderable.fg = this._fg;
      }
      return existingRenderable;
    }
  }
  createOrUpdateSide(side, target, lineColors, lineSigns, lineNumbers, hideLineNumbers, width) {
    const sideRef = side === "left" ? this.leftSide : this.rightSide;
    const addedFlag = side === "left" ? this.leftSideAdded : this.rightSideAdded;
    if (!sideRef) {
      const newSide = new LineNumberRenderable(this.ctx, {
        id: this.id ? `${this.id}-${side}` : void 0,
        target,
        fg: this._lineNumberFg,
        bg: this._lineNumberBg,
        lineColors,
        lineSigns,
        lineNumbers,
        lineNumberOffset: 0,
        hideLineNumbers,
        width,
        height: "100%"
      });
      newSide.showLineNumbers = this._showLineNumbers;
      super.add(newSide);
      if (side === "left") {
        this.leftSide = newSide;
        this.leftSideAdded = true;
      } else {
        this.rightSide = newSide;
        this.rightSideAdded = true;
      }
    } else {
      sideRef.width = width;
      sideRef.fg = this._lineNumberFg;
      sideRef.bg = this._lineNumberBg;
      sideRef.setLineColors(lineColors);
      sideRef.setLineSigns(lineSigns);
      sideRef.setLineNumbers(lineNumbers);
      sideRef.setHideLineNumbers(hideLineNumbers);
      if (!addedFlag) {
        super.add(sideRef);
        if (side === "left") {
          this.leftSideAdded = true;
        } else {
          this.rightSideAdded = true;
        }
      }
    }
  }
  lineColorConfig(gutter, override, fallback) {
    return { gutter, content: override ?? fallback };
  }
  clearViewRenderables() {
    this.removeErrorRenderables();
    if (this.leftSide && this.leftSideAdded) {
      super.remove(this.leftSide.id);
      this.leftSideAdded = false;
    }
    if (this.rightSide && this.rightSideAdded) {
      super.remove(this.rightSide.id);
      this.rightSideAdded = false;
    }
  }
  removeErrorRenderables() {
    for (const errorRenderable of [this.errorTextRenderable, this.errorCodeRenderable]) {
      if (!errorRenderable) continue;
      const errorIndex = this.getChildren().indexOf(errorRenderable);
      if (errorIndex !== -1) {
        super.remove(errorRenderable.id);
      }
    }
  }
  buildUnifiedView() {
    if (!this._parsedDiff) return;
    this.flexDirection = "column";
    this.removeErrorRenderables();
    const contentLines = [];
    const lineColors = /* @__PURE__ */ new Map();
    const lineSigns = /* @__PURE__ */ new Map();
    const lineNumbers = /* @__PURE__ */ new Map();
    let lineIndex = 0;
    for (const hunk of this._parsedDiff.hunks) {
      this._hunkStartLines.push(lineIndex);
      let oldLineNum = hunk.oldStart;
      let newLineNum = hunk.newStart;
      for (const line of hunk.lines) {
        const firstChar = line[0];
        const content2 = line.slice(1);
        if (firstChar === "+") {
          contentLines.push(content2);
          lineColors.set(lineIndex, this.lineColorConfig(this._addedLineNumberBg, this._addedContentBg, this._addedBg));
          lineSigns.set(lineIndex, {
            after: " +",
            afterColor: this._addedSignColor
          });
          lineNumbers.set(lineIndex, newLineNum);
          newLineNum++;
          lineIndex++;
        } else if (firstChar === "-") {
          contentLines.push(content2);
          lineColors.set(lineIndex, this.lineColorConfig(this._removedLineNumberBg, this._removedContentBg, this._removedBg));
          lineSigns.set(lineIndex, {
            after: " -",
            afterColor: this._removedSignColor
          });
          lineNumbers.set(lineIndex, oldLineNum);
          oldLineNum++;
          lineIndex++;
        } else if (firstChar === " ") {
          contentLines.push(content2);
          lineColors.set(lineIndex, this.lineColorConfig(this._lineNumberBg, this._contextContentBg, this._contextBg));
          lineNumbers.set(lineIndex, newLineNum);
          oldLineNum++;
          newLineNum++;
          lineIndex++;
        }
      }
    }
    const content = contentLines.join("\n");
    const codeRenderable = this.createOrUpdateCodeRenderable("left", content, this._wrapMode);
    this.attachLineInfoListeners();
    this.createOrUpdateSide("left", codeRenderable, lineColors, lineSigns, lineNumbers, /* @__PURE__ */ new Set(), "100%");
    if (this.rightSide && this.rightSideAdded) {
      super.remove(this.rightSide.id);
      this.rightSideAdded = false;
    }
  }
  buildSplitView() {
    if (!this._parsedDiff) return;
    this.flexDirection = "row";
    this.removeErrorRenderables();
    const leftLogicalLines = [];
    const rightLogicalLines = [];
    const hunkFirstLeftLine = [];
    for (const hunk of this._parsedDiff.hunks) {
      hunkFirstLeftLine.push(leftLogicalLines.length);
      let oldLineNum = hunk.oldStart;
      let newLineNum = hunk.newStart;
      let i = 0;
      while (i < hunk.lines.length) {
        const line = hunk.lines[i];
        const firstChar = line[0];
        if (firstChar === " ") {
          const content = line.slice(1);
          leftLogicalLines.push({
            content,
            lineNum: oldLineNum,
            color: this._contextBg,
            type: "context"
          });
          rightLogicalLines.push({
            content,
            lineNum: newLineNum,
            color: this._contextBg,
            type: "context"
          });
          oldLineNum++;
          newLineNum++;
          i++;
        } else if (firstChar === "\\") {
          i++;
        } else {
          const removes = [];
          const adds = [];
          while (i < hunk.lines.length) {
            const currentLine = hunk.lines[i];
            const currentChar = currentLine[0];
            if (currentChar === " " || currentChar === "\\") {
              break;
            }
            const content = currentLine.slice(1);
            if (currentChar === "-") {
              removes.push({ content, lineNum: oldLineNum });
              oldLineNum++;
            } else if (currentChar === "+") {
              adds.push({ content, lineNum: newLineNum });
              newLineNum++;
            }
            i++;
          }
          const maxLength = Math.max(removes.length, adds.length);
          for (let j = 0; j < maxLength; j++) {
            if (j < removes.length) {
              leftLogicalLines.push({
                content: removes[j].content,
                lineNum: removes[j].lineNum,
                color: this._removedBg,
                sign: {
                  after: " -",
                  afterColor: this._removedSignColor
                },
                type: "remove"
              });
            } else {
              leftLogicalLines.push({
                content: "",
                hideLineNumber: true,
                type: "empty"
              });
            }
            if (j < adds.length) {
              rightLogicalLines.push({
                content: adds[j].content,
                lineNum: adds[j].lineNum,
                color: this._addedBg,
                sign: {
                  after: " +",
                  afterColor: this._addedSignColor
                },
                type: "add"
              });
            } else {
              rightLogicalLines.push({
                content: "",
                hideLineNumber: true,
                type: "empty"
              });
            }
          }
        }
      }
    }
    for (const startIndex of hunkFirstLeftLine) {
      const firstLine = leftLogicalLines[startIndex];
      if (firstLine) firstLine.hunkStart = true;
    }
    const canDoWrapAlignment = this.width > 0 && (this._wrapMode === "word" || this._wrapMode === "char");
    const preLeftContent = leftLogicalLines.map((l) => l.content).join("\n");
    const preRightContent = rightLogicalLines.map((l) => l.content).join("\n");
    const needsConsistentConcealing = (this._wrapMode === "word" || this._wrapMode === "char") && this._conceal && this._filetype;
    const drawUnstyledText = !needsConsistentConcealing;
    const leftCodeRenderable = this.createOrUpdateCodeRenderable(
      "left",
      preLeftContent,
      this._wrapMode,
      drawUnstyledText
    );
    const rightCodeRenderable = this.createOrUpdateCodeRenderable(
      "right",
      preRightContent,
      this._wrapMode,
      drawUnstyledText
    );
    this.attachLineInfoListeners();
    let finalLeftLines;
    let finalRightLines;
    const leftIsHighlighting = leftCodeRenderable.isHighlighting;
    const rightIsHighlighting = rightCodeRenderable.isHighlighting;
    const highlightingInProgress = needsConsistentConcealing && (leftIsHighlighting || rightIsHighlighting);
    if (highlightingInProgress) {
      this._waitingForHighlight = true;
      this.attachLineInfoListeners();
    }
    const shouldDoAlignment = canDoWrapAlignment && !highlightingInProgress;
    if (shouldDoAlignment) {
      const leftLineInfo = leftCodeRenderable.lineInfo;
      const rightLineInfo = rightCodeRenderable.lineInfo;
      const leftSources = leftLineInfo.lineSources || [];
      const rightSources = rightLineInfo.lineSources || [];
      const leftVisualCounts = /* @__PURE__ */ new Map();
      const rightVisualCounts = /* @__PURE__ */ new Map();
      for (const logicalLine of leftSources) {
        leftVisualCounts.set(logicalLine, (leftVisualCounts.get(logicalLine) || 0) + 1);
      }
      for (const logicalLine of rightSources) {
        rightVisualCounts.set(logicalLine, (rightVisualCounts.get(logicalLine) || 0) + 1);
      }
      finalLeftLines = [];
      finalRightLines = [];
      let leftVisualPos = 0;
      let rightVisualPos = 0;
      for (let i = 0; i < leftLogicalLines.length; i++) {
        const leftLine = leftLogicalLines[i];
        const rightLine = rightLogicalLines[i];
        const leftVisualCount = leftVisualCounts.get(i) ?? 0;
        const rightVisualCount = rightVisualCounts.get(i) ?? 0;
        if (leftVisualPos < rightVisualPos) {
          const pad = rightVisualPos - leftVisualPos;
          for (let p = 0; p < pad; p++) {
            finalLeftLines.push({ content: "", hideLineNumber: true, type: "empty" });
          }
          leftVisualPos += pad;
        } else if (rightVisualPos < leftVisualPos) {
          const pad = leftVisualPos - rightVisualPos;
          for (let p = 0; p < pad; p++) {
            finalRightLines.push({ content: "", hideLineNumber: true, type: "empty" });
          }
          rightVisualPos += pad;
        }
        finalLeftLines.push(leftLine);
        finalRightLines.push(rightLine);
        leftVisualPos += leftVisualCount;
        rightVisualPos += rightVisualCount;
      }
      if (leftVisualPos < rightVisualPos) {
        const pad = rightVisualPos - leftVisualPos;
        for (let p = 0; p < pad; p++) {
          finalLeftLines.push({ content: "", hideLineNumber: true, type: "empty" });
        }
      } else if (rightVisualPos < leftVisualPos) {
        const pad = leftVisualPos - rightVisualPos;
        for (let p = 0; p < pad; p++) {
          finalRightLines.push({ content: "", hideLineNumber: true, type: "empty" });
        }
      }
    } else {
      finalLeftLines = leftLogicalLines;
      finalRightLines = rightLogicalLines;
    }
    const leftLineColors = /* @__PURE__ */ new Map();
    const rightLineColors = /* @__PURE__ */ new Map();
    const leftLineSigns = /* @__PURE__ */ new Map();
    const rightLineSigns = /* @__PURE__ */ new Map();
    const leftHideLineNumbers = /* @__PURE__ */ new Set();
    const rightHideLineNumbers = /* @__PURE__ */ new Set();
    const leftLineNumbers = /* @__PURE__ */ new Map();
    const rightLineNumbers = /* @__PURE__ */ new Map();
    finalLeftLines.forEach((line, index) => {
      if (line.hunkStart) {
        this._hunkStartLines.push(index);
      }
      if (line.lineNum !== void 0) {
        leftLineNumbers.set(index, line.lineNum);
      }
      if (line.hideLineNumber) {
        leftHideLineNumbers.add(index);
      }
      if (line.type === "remove") {
        leftLineColors.set(
          index,
          this.lineColorConfig(this._removedLineNumberBg, this._removedContentBg, this._removedBg)
        );
      } else if (line.type === "context") {
        leftLineColors.set(index, this.lineColorConfig(this._lineNumberBg, this._contextContentBg, this._contextBg));
      }
      if (line.sign) {
        leftLineSigns.set(index, line.sign);
      }
    });
    finalRightLines.forEach((line, index) => {
      if (line.lineNum !== void 0) {
        rightLineNumbers.set(index, line.lineNum);
      }
      if (line.hideLineNumber) {
        rightHideLineNumbers.add(index);
      }
      if (line.type === "add") {
        rightLineColors.set(index, this.lineColorConfig(this._addedLineNumberBg, this._addedContentBg, this._addedBg));
      } else if (line.type === "context") {
        rightLineColors.set(index, this.lineColorConfig(this._lineNumberBg, this._contextContentBg, this._contextBg));
      }
      if (line.sign) {
        rightLineSigns.set(index, line.sign);
      }
    });
    const leftContentFinal = finalLeftLines.map((l) => l.content).join("\n");
    const rightContentFinal = finalRightLines.map((l) => l.content).join("\n");
    leftCodeRenderable.content = leftContentFinal;
    rightCodeRenderable.content = rightContentFinal;
    this.createOrUpdateSide(
      "left",
      leftCodeRenderable,
      leftLineColors,
      leftLineSigns,
      leftLineNumbers,
      leftHideLineNumbers,
      "50%"
    );
    this.createOrUpdateSide(
      "right",
      rightCodeRenderable,
      rightLineColors,
      rightLineSigns,
      rightLineNumbers,
      rightHideLineNumbers,
      "50%"
    );
  }
  get diff() {
    return this._diff;
  }
  set diff(value) {
    if (this._diff !== value) {
      this._diff = value;
      this._waitingForHighlight = false;
      this.parseDiff();
      this.rebuildView();
    }
  }
  get syncScroll() {
    return this._syncScroll;
  }
  set syncScroll(value) {
    if (this._syncScroll !== value) {
      this._syncScroll = value;
    }
  }
  get view() {
    return this._view;
  }
  set view(value) {
    if (this._view !== value) {
      this._view = value;
      this.flexDirection = value === "split" ? "row" : "column";
      this.buildView();
    }
  }
  get filetype() {
    return this._filetype;
  }
  set filetype(value) {
    if (this._filetype !== value) {
      this._filetype = value;
      this.rebuildView();
    }
  }
  get syntaxStyle() {
    return this._syntaxStyle;
  }
  set syntaxStyle(value) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value;
      this.rebuildView();
    }
  }
  get wrapMode() {
    return this._wrapMode;
  }
  set wrapMode(value) {
    if (this._wrapMode !== value) {
      this._wrapMode = value;
      this.invalidateHunkRowOffsets();
      if (this._view === "unified" && this.leftCodeRenderable) {
        this.leftCodeRenderable.wrapMode = value ?? "none";
      } else if (this._view === "split") {
        this.requestRebuild();
      }
    }
  }
  get showLineNumbers() {
    return this._showLineNumbers;
  }
  set showLineNumbers(value) {
    if (this._showLineNumbers !== value) {
      this._showLineNumbers = value;
      if (this.leftSide) {
        this.leftSide.showLineNumbers = value;
      }
      if (this.rightSide) {
        this.rightSide.showLineNumbers = value;
      }
    }
  }
  get addedBg() {
    return this._addedBg;
  }
  set addedBg(value) {
    const parsed = parseColor(value);
    if (this._addedBg !== parsed) {
      this._addedBg = parsed;
      this.rebuildView();
    }
  }
  get removedBg() {
    return this._removedBg;
  }
  set removedBg(value) {
    const parsed = parseColor(value);
    if (this._removedBg !== parsed) {
      this._removedBg = parsed;
      this.rebuildView();
    }
  }
  get contextBg() {
    return this._contextBg;
  }
  set contextBg(value) {
    const parsed = parseColor(value);
    if (this._contextBg !== parsed) {
      this._contextBg = parsed;
      this.rebuildView();
    }
  }
  get addedSignColor() {
    return this._addedSignColor;
  }
  set addedSignColor(value) {
    const parsed = parseColor(value);
    if (this._addedSignColor !== parsed) {
      this._addedSignColor = parsed;
      this.rebuildView();
    }
  }
  get removedSignColor() {
    return this._removedSignColor;
  }
  set removedSignColor(value) {
    const parsed = parseColor(value);
    if (this._removedSignColor !== parsed) {
      this._removedSignColor = parsed;
      this.rebuildView();
    }
  }
  get addedLineNumberBg() {
    return this._addedLineNumberBg;
  }
  set addedLineNumberBg(value) {
    const parsed = parseColor(value);
    if (this._addedLineNumberBg !== parsed) {
      this._addedLineNumberBg = parsed;
      this.rebuildView();
    }
  }
  get removedLineNumberBg() {
    return this._removedLineNumberBg;
  }
  set removedLineNumberBg(value) {
    const parsed = parseColor(value);
    if (this._removedLineNumberBg !== parsed) {
      this._removedLineNumberBg = parsed;
      this.rebuildView();
    }
  }
  get lineNumberFg() {
    return this._lineNumberFg;
  }
  set lineNumberFg(value) {
    const parsed = parseColor(value);
    if (this._lineNumberFg !== parsed) {
      this._lineNumberFg = parsed;
      this.rebuildView();
    }
  }
  get lineNumberBg() {
    return this._lineNumberBg;
  }
  set lineNumberBg(value) {
    const parsed = parseColor(value);
    if (this._lineNumberBg !== parsed) {
      this._lineNumberBg = parsed;
      this.rebuildView();
    }
  }
  get addedContentBg() {
    return this._addedContentBg;
  }
  set addedContentBg(value) {
    const parsed = value ? parseColor(value) : null;
    if (this._addedContentBg !== parsed) {
      this._addedContentBg = parsed;
      this.rebuildView();
    }
  }
  get removedContentBg() {
    return this._removedContentBg;
  }
  set removedContentBg(value) {
    const parsed = value ? parseColor(value) : null;
    if (this._removedContentBg !== parsed) {
      this._removedContentBg = parsed;
      this.rebuildView();
    }
  }
  get contextContentBg() {
    return this._contextContentBg;
  }
  set contextContentBg(value) {
    const parsed = value ? parseColor(value) : null;
    if (this._contextContentBg !== parsed) {
      this._contextContentBg = parsed;
      this.rebuildView();
    }
  }
  get selectionBg() {
    return this._selectionBg;
  }
  set selectionBg(value) {
    const parsed = value ? parseColor(value) : void 0;
    if (this._selectionBg !== parsed) {
      this._selectionBg = parsed;
      if (this.leftCodeRenderable) {
        this.leftCodeRenderable.selectionBg = parsed;
      }
      if (this.rightCodeRenderable) {
        this.rightCodeRenderable.selectionBg = parsed;
      }
    }
  }
  get selectionFg() {
    return this._selectionFg;
  }
  set selectionFg(value) {
    const parsed = value ? parseColor(value) : void 0;
    if (this._selectionFg !== parsed) {
      this._selectionFg = parsed;
      if (this.leftCodeRenderable) {
        this.leftCodeRenderable.selectionFg = parsed;
      }
      if (this.rightCodeRenderable) {
        this.rightCodeRenderable.selectionFg = parsed;
      }
    }
  }
  get conceal() {
    return this._conceal;
  }
  set conceal(value) {
    if (this._conceal !== value) {
      this._conceal = value;
      this.rebuildView();
    }
  }
  get fg() {
    return this._fg;
  }
  set fg(value) {
    const parsed = value ? parseColor(value) : void 0;
    if (this._fg !== parsed) {
      this._fg = parsed;
      if (this.leftCodeRenderable) {
        this.leftCodeRenderable.fg = parsed;
      }
      if (this.rightCodeRenderable) {
        this.rightCodeRenderable.fg = parsed;
      }
    }
  }
  setLineColor(line, color) {
    this.leftSide?.setLineColor(line, color);
    this.rightSide?.setLineColor(line, color);
  }
  clearLineColor(line) {
    this.leftSide?.clearLineColor(line);
    this.rightSide?.clearLineColor(line);
  }
  setLineColors(lineColors) {
    this.leftSide?.setLineColors(lineColors);
    this.rightSide?.setLineColors(lineColors);
  }
  clearAllLineColors() {
    this.leftSide?.clearAllLineColors();
    this.rightSide?.clearAllLineColors();
  }
  highlightLines(startLine, endLine, color) {
    this.leftSide?.highlightLines(startLine, endLine, color);
    this.rightSide?.highlightLines(startLine, endLine, color);
  }
  clearHighlightLines(startLine, endLine) {
    this.leftSide?.clearHighlightLines(startLine, endLine);
    this.rightSide?.clearHighlightLines(startLine, endLine);
  }
  getHunkRowOffsets() {
    if (this._hunkRowOffsets) return [...this._hunkRowOffsets];
    this._hunkRowOffsets = this.computeHunkRowOffsets();
    return [...this._hunkRowOffsets];
  }
  computeHunkRowOffsets() {
    if (this._hunkStartLines.length === 0) return [];
    const sources = this.leftCodeRenderable?.lineInfo.lineSources;
    if (!sources || sources.length === 0) return [...this._hunkStartLines];
    const offsets = [];
    let visualRow = 0;
    for (const hunkStartLine of this._hunkStartLines) {
      while (visualRow < sources.length && sources[visualRow] < hunkStartLine) {
        visualRow++;
      }
      offsets.push(visualRow < sources.length ? visualRow : hunkStartLine);
    }
    return offsets;
  }
};

// src/renderables/Textarea.ts
var defaultTextareaKeyBindings = [
  { name: "left", action: "move-left" },
  { name: "right", action: "move-right" },
  { name: "up", action: "move-up" },
  { name: "down", action: "move-down" },
  { name: "left", shift: true, action: "select-left" },
  { name: "right", shift: true, action: "select-right" },
  { name: "up", shift: true, action: "select-up" },
  { name: "down", shift: true, action: "select-down" },
  { name: "home", action: "buffer-home" },
  { name: "end", action: "buffer-end" },
  { name: "home", shift: true, action: "select-buffer-home" },
  { name: "end", shift: true, action: "select-buffer-end" },
  { name: "a", ctrl: true, action: "line-home" },
  { name: "e", ctrl: true, action: "line-end" },
  { name: "a", ctrl: true, shift: true, action: "select-line-home" },
  { name: "e", ctrl: true, shift: true, action: "select-line-end" },
  { name: "a", meta: true, action: "visual-line-home" },
  { name: "e", meta: true, action: "visual-line-end" },
  { name: "a", meta: true, shift: true, action: "select-visual-line-home" },
  { name: "e", meta: true, shift: true, action: "select-visual-line-end" },
  { name: "f", ctrl: true, action: "move-right" },
  { name: "b", ctrl: true, action: "move-left" },
  { name: "w", ctrl: true, action: "delete-word-backward" },
  { name: "backspace", ctrl: true, action: "delete-word-backward" },
  { name: "d", meta: true, action: "delete-word-forward" },
  { name: "delete", meta: true, action: "delete-word-forward" },
  { name: "delete", ctrl: true, action: "delete-word-forward" },
  { name: "d", ctrl: true, shift: true, action: "delete-line" },
  { name: "k", ctrl: true, action: "delete-to-line-end" },
  { name: "u", ctrl: true, action: "delete-to-line-start" },
  { name: "backspace", action: "backspace" },
  { name: "backspace", shift: true, action: "backspace" },
  { name: "d", ctrl: true, action: "delete" },
  { name: "delete", action: "delete" },
  { name: "delete", shift: true, action: "delete" },
  { name: "return", action: "newline" },
  { name: "kpenter", action: "newline" },
  { name: "linefeed", action: "newline" },
  { name: "return", meta: true, action: "submit" },
  { name: "kpenter", meta: true, action: "submit" },
  // undo/redo
  { name: "-", ctrl: true, action: "undo" },
  { name: ".", ctrl: true, action: "redo" },
  { name: "z", super: true, action: "undo" },
  { name: "z", super: true, shift: true, action: "redo" },
  { name: "f", meta: true, action: "word-forward" },
  { name: "b", meta: true, action: "word-backward" },
  { name: "right", meta: true, action: "word-forward" },
  { name: "left", meta: true, action: "word-backward" },
  { name: "right", ctrl: true, action: "word-forward" },
  { name: "left", ctrl: true, action: "word-backward" },
  { name: "f", meta: true, shift: true, action: "select-word-forward" },
  { name: "b", meta: true, shift: true, action: "select-word-backward" },
  { name: "right", meta: true, shift: true, action: "select-word-forward" },
  { name: "left", meta: true, shift: true, action: "select-word-backward" },
  { name: "backspace", meta: true, action: "delete-word-backward" },
  // super (cmd/win) + arrow keys for Kitty Keyboard mode
  { name: "left", super: true, action: "visual-line-home" },
  { name: "right", super: true, action: "visual-line-end" },
  { name: "up", super: true, action: "buffer-home" },
  { name: "down", super: true, action: "buffer-end" },
  { name: "left", super: true, shift: true, action: "select-visual-line-home" },
  { name: "right", super: true, shift: true, action: "select-visual-line-end" },
  { name: "up", super: true, shift: true, action: "select-buffer-home" },
  { name: "down", super: true, shift: true, action: "select-buffer-end" },
  { name: "a", super: true, action: "select-all" }
];
var TextareaRenderable = class _TextareaRenderable extends EditBufferRenderable {
  _placeholder;
  _placeholderColor;
  _unfocusedBackgroundColor;
  _unfocusedTextColor;
  _focusedBackgroundColor;
  _focusedTextColor;
  _keyBindingsMap;
  _keyAliasMap;
  _keyBindings;
  _actionHandlers;
  _initialValueSet = false;
  _submitListener = void 0;
  static defaults = {
    backgroundColor: "transparent",
    textColor: "#FFFFFF",
    focusedBackgroundColor: "transparent",
    focusedTextColor: "#FFFFFF",
    placeholder: null,
    placeholderColor: "#666666"
  };
  constructor(ctx, options) {
    const defaults = _TextareaRenderable.defaults;
    const baseOptions = {
      ...options,
      backgroundColor: options.backgroundColor || defaults.backgroundColor,
      textColor: options.textColor || defaults.textColor
    };
    super(ctx, baseOptions);
    this._unfocusedBackgroundColor = parseColor(options.backgroundColor || defaults.backgroundColor);
    this._unfocusedTextColor = parseColor(options.textColor || defaults.textColor);
    this._focusedBackgroundColor = parseColor(
      options.focusedBackgroundColor || options.backgroundColor || defaults.focusedBackgroundColor
    );
    this._focusedTextColor = parseColor(options.focusedTextColor || options.textColor || defaults.focusedTextColor);
    this._placeholder = options.placeholder ?? defaults.placeholder;
    this._placeholderColor = parseColor(options.placeholderColor ?? defaults.placeholderColor);
    this._keyAliasMap = mergeKeyAliases(defaultKeyAliases, options.keyAliasMap || {});
    this._keyBindings = options.keyBindings || [];
    const mergedBindings = mergeKeyBindings(defaultTextareaKeyBindings, this._keyBindings);
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap);
    this._actionHandlers = this.buildActionHandlers();
    this._submitListener = options.onSubmit;
    if (options.initialValue) {
      this.setText(options.initialValue);
      this._initialValueSet = true;
    }
    this.updateColors();
    this.applyPlaceholder(this._placeholder);
  }
  applyPlaceholder(placeholder) {
    if (placeholder === null) {
      this.editorView.setPlaceholderStyledText([]);
      return;
    }
    if (typeof placeholder === "string") {
      const colorStyle = fg(this._placeholderColor);
      const chunks = [colorStyle(placeholder)];
      this.editorView.setPlaceholderStyledText(chunks);
    } else {
      this.editorView.setPlaceholderStyledText(placeholder.chunks);
    }
  }
  buildActionHandlers() {
    return /* @__PURE__ */ new Map([
      ["move-left", () => this.moveCursorLeft()],
      ["move-right", () => this.moveCursorRight()],
      ["move-up", () => this.moveCursorUp()],
      ["move-down", () => this.moveCursorDown()],
      ["select-left", () => this.moveCursorLeft({ select: true })],
      ["select-right", () => this.moveCursorRight({ select: true })],
      ["select-up", () => this.moveCursorUp({ select: true })],
      ["select-down", () => this.moveCursorDown({ select: true })],
      ["line-home", () => this.gotoLineHome()],
      ["line-end", () => this.gotoLineEnd()],
      ["select-line-home", () => this.gotoLineHome({ select: true })],
      ["select-line-end", () => this.gotoLineEnd({ select: true })],
      ["visual-line-home", () => this.gotoVisualLineHome()],
      ["visual-line-end", () => this.gotoVisualLineEnd()],
      ["select-visual-line-home", () => this.gotoVisualLineHome({ select: true })],
      ["select-visual-line-end", () => this.gotoVisualLineEnd({ select: true })],
      ["select-buffer-home", () => this.gotoBufferHome({ select: true })],
      ["select-buffer-end", () => this.gotoBufferEnd({ select: true })],
      ["buffer-home", () => this.gotoBufferHome()],
      ["buffer-end", () => this.gotoBufferEnd()],
      ["delete-line", () => this.deleteLine()],
      ["delete-to-line-end", () => this.deleteToLineEnd()],
      ["delete-to-line-start", () => this.deleteToLineStart()],
      ["backspace", () => this.deleteCharBackward()],
      ["delete", () => this.deleteChar()],
      ["newline", () => this.newLine()],
      ["undo", () => this.undo()],
      ["redo", () => this.redo()],
      ["word-forward", () => this.moveWordForward()],
      ["word-backward", () => this.moveWordBackward()],
      ["select-word-forward", () => this.moveWordForward({ select: true })],
      ["select-word-backward", () => this.moveWordBackward({ select: true })],
      ["delete-word-forward", () => this.deleteWordForward()],
      ["delete-word-backward", () => this.deleteWordBackward()],
      ["select-all", () => this.selectAll()],
      ["submit", () => this.submit()]
    ]);
  }
  handlePaste(event) {
    this.insertText(stripAnsiSequences(decodePasteBytes(event.bytes)));
  }
  handleKeyPress(key) {
    if (this.traits.suspend !== true) {
      const action = getKeyBindingAction(this._keyBindingsMap, key);
      if (action) {
        const handler = this._actionHandlers.get(action);
        if (handler) {
          return handler();
        }
      }
    }
    if (!key.ctrl && !key.meta && !key.super && !key.hyper) {
      if (key.name === "space") {
        this.insertText(" ");
        return true;
      }
      if (key.sequence) {
        const firstCharCode = key.sequence.charCodeAt(0);
        if (firstCharCode < 32) {
          return false;
        }
        if (firstCharCode === 127) {
          return false;
        }
        this.insertText(key.sequence);
        return true;
      }
    }
    return false;
  }
  updateColors() {
    const effectiveBg = this._focused ? this._focusedBackgroundColor : this._unfocusedBackgroundColor;
    const effectiveFg = this._focused ? this._focusedTextColor : this._unfocusedTextColor;
    super.backgroundColor = effectiveBg;
    super.textColor = effectiveFg;
  }
  focus() {
    super.focus();
    if (this.isDestroyed || !this.focused) return;
    this.updateColors();
  }
  blur() {
    super.blur();
    if (!this.isDestroyed) {
      this.updateColors();
    }
  }
  get placeholder() {
    return this._placeholder;
  }
  set placeholder(value) {
    const normalizedValue = value ?? null;
    if (this._placeholder !== normalizedValue) {
      this._placeholder = normalizedValue;
      this.applyPlaceholder(normalizedValue);
      this.requestRender();
    }
  }
  get placeholderColor() {
    return this._placeholderColor;
  }
  set placeholderColor(value) {
    const newColor = parseColor(value ?? _TextareaRenderable.defaults.placeholderColor);
    if (this._placeholderColor !== newColor) {
      this._placeholderColor = newColor;
      this.applyPlaceholder(this._placeholder);
      this.requestRender();
    }
  }
  get backgroundColor() {
    return this._unfocusedBackgroundColor;
  }
  set backgroundColor(value) {
    const newColor = parseColor(value ?? _TextareaRenderable.defaults.backgroundColor);
    if (this._unfocusedBackgroundColor !== newColor) {
      this._unfocusedBackgroundColor = newColor;
      this.updateColors();
    }
  }
  get textColor() {
    return this._unfocusedTextColor;
  }
  set textColor(value) {
    const newColor = parseColor(value ?? _TextareaRenderable.defaults.textColor);
    if (this._unfocusedTextColor !== newColor) {
      this._unfocusedTextColor = newColor;
      this.updateColors();
    }
  }
  set focusedBackgroundColor(value) {
    const newColor = parseColor(value ?? _TextareaRenderable.defaults.focusedBackgroundColor);
    if (this._focusedBackgroundColor !== newColor) {
      this._focusedBackgroundColor = newColor;
      this.updateColors();
    }
  }
  set focusedTextColor(value) {
    const newColor = parseColor(value ?? _TextareaRenderable.defaults.focusedTextColor);
    if (this._focusedTextColor !== newColor) {
      this._focusedTextColor = newColor;
      this.updateColors();
    }
  }
  set initialValue(value) {
    if (!this._initialValueSet) {
      this.setText(value);
      this._initialValueSet = true;
    }
  }
  submit() {
    if (this._submitListener) {
      this._submitListener({});
    }
    return true;
  }
  set onSubmit(handler) {
    this._submitListener = handler;
  }
  get onSubmit() {
    return this._submitListener;
  }
  set keyBindings(bindings) {
    this._keyBindings = bindings;
    const mergedBindings = mergeKeyBindings(defaultTextareaKeyBindings, bindings);
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap);
  }
  set keyAliasMap(aliases2) {
    this._keyAliasMap = mergeKeyAliases(defaultKeyAliases, aliases2);
    const mergedBindings = mergeKeyBindings(defaultTextareaKeyBindings, this._keyBindings);
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap);
  }
  get extmarks() {
    return this.editorView.extmarks;
  }
};

// src/renderables/Input.ts
function truncateInput(text, maxLength) {
  const value = text.substring(0, maxLength);
  const last = value.charCodeAt(value.length - 1);
  const next = text.charCodeAt(value.length);
  return last >= 55296 && last <= 56319 && next >= 56320 && next <= 57343 ? value.slice(0, -1) : value;
}
var InputRenderableEvents = /* @__PURE__ */ ((InputRenderableEvents2) => {
  InputRenderableEvents2["INPUT"] = "input";
  InputRenderableEvents2["CHANGE"] = "change";
  InputRenderableEvents2["ENTER"] = "enter";
  return InputRenderableEvents2;
})(InputRenderableEvents || {});
var InputRenderable = class _InputRenderable extends TextareaRenderable {
  _maxLength;
  _minLength;
  _lastCommittedValue = "";
  // Only specify defaults that differ from TextareaRenderable/EditBufferRenderable
  static defaultOptions = {
    // Different from Textarea's null
    placeholder: "",
    // Input-specific
    maxLength: 1e3,
    minLength: 0,
    value: ""
  };
  constructor(ctx, options) {
    const defaults = _InputRenderable.defaultOptions;
    const maxLength = options.maxLength ?? defaults.maxLength;
    const minLength = options.minLength ?? defaults.minLength;
    const rawValue = options.value ?? defaults.value;
    const initialValue = truncateInput(rawValue.replace(/[\n\r]/g, ""), maxLength);
    if (minLength > maxLength) {
      throw new Error(`InputRenderable: minLength (${minLength}) cannot be greater than maxLength (${maxLength})`);
    }
    super(ctx, {
      ...options,
      placeholder: options.placeholder ?? defaults.placeholder,
      initialValue,
      // Single-line constraints
      height: 1,
      wrapMode: "none",
      // Override return/linefeed to submit instead of newline
      keyBindings: [
        { name: "return", action: "submit" },
        { name: "kpenter", action: "submit" },
        { name: "linefeed", action: "submit" },
        ...options.keyBindings || []
      ]
    });
    this._maxLength = maxLength;
    this._minLength = minLength;
    this._lastCommittedValue = this.plainText;
    if (initialValue) {
      this.gotoLineTextEnd();
    }
  }
  /**
   * Prevent newlines in single-line input
   */
  newLine() {
    return false;
  }
  /**
   * Handle paste - strip newlines and enforce maxLength
   */
  handlePaste(event) {
    const sanitized = stripAnsiSequences(decodePasteBytes(event.bytes)).replace(/[\n\r]/g, "");
    if (sanitized) {
      this.insertText(sanitized);
    }
  }
  /**
   * Insert text - strip newlines and enforce maxLength
   */
  insertText(text) {
    const sanitized = text.replace(/[\n\r]/g, "");
    if (!sanitized) return;
    const currentLength = this.plainText.length;
    const selectedLength = this.hasSelection() ? this.getSelectedText().length : 0;
    const remaining = this._maxLength - currentLength + selectedLength;
    if (remaining <= 0) return;
    const toInsert = truncateInput(sanitized, remaining);
    if (!toInsert) return;
    super.insertText(toInsert);
    this.emit("input" /* INPUT */, this.plainText);
  }
  get value() {
    return this.plainText;
  }
  set value(value) {
    const newValue = truncateInput(value.replace(/[\n\r]/g, ""), this._maxLength);
    const currentValue = this.plainText;
    if (currentValue !== newValue) {
      this.setText(newValue);
      this.gotoLineTextEnd();
      this.emit("input" /* INPUT */, newValue);
    }
  }
  /** Preserve single-line and length constraints for undoable programmatic edits such as completion. */
  replaceText(text, cursorOffset) {
    const value = truncateInput(text.replace(/[\n\r]/g, ""), this._maxLength);
    super.replaceText(value, cursorOffset);
    this.emit("input" /* INPUT */, this.plainText);
  }
  focus() {
    if (this.isDestroyed || this.focused || !this.focusable) return;
    this._lastCommittedValue = this.plainText;
    super.focus();
  }
  blur() {
    if (!this.isDestroyed) {
      const currentValue = this.plainText;
      if (currentValue !== this._lastCommittedValue) {
        this._lastCommittedValue = currentValue;
        this.emit("change" /* CHANGE */, currentValue);
      }
    }
    super.blur();
  }
  submit() {
    const currentValue = this.plainText;
    if (currentValue.length < this._minLength) {
      return false;
    }
    if (currentValue !== this._lastCommittedValue) {
      this._lastCommittedValue = currentValue;
      this.emit("change" /* CHANGE */, currentValue);
    }
    this.emit("enter" /* ENTER */, currentValue);
    return true;
  }
  deleteCharBackward() {
    const result = super.deleteCharBackward();
    this.emit("input" /* INPUT */, this.plainText);
    return result;
  }
  deleteChar() {
    const result = super.deleteChar();
    this.emit("input" /* INPUT */, this.plainText);
    return result;
  }
  deleteLine() {
    const result = super.deleteLine();
    this.emit("input" /* INPUT */, this.plainText);
    return result;
  }
  deleteWordBackward() {
    const result = super.deleteWordBackward();
    this.emit("input" /* INPUT */, this.plainText);
    return result;
  }
  deleteWordForward() {
    const result = super.deleteWordForward();
    this.emit("input" /* INPUT */, this.plainText);
    return result;
  }
  deleteToLineStart() {
    const result = super.deleteToLineStart();
    this.emit("input" /* INPUT */, this.plainText);
    return result;
  }
  deleteToLineEnd() {
    const result = super.deleteToLineEnd();
    this.emit("input" /* INPUT */, this.plainText);
    return result;
  }
  undo() {
    const result = super.undo();
    this.emit("input" /* INPUT */, this.plainText);
    return result;
  }
  redo() {
    const result = super.redo();
    this.emit("input" /* INPUT */, this.plainText);
    return result;
  }
  deleteCharacter(direction) {
    if (direction === "backward") {
      this.deleteCharBackward();
    } else {
      this.deleteChar();
    }
  }
  set maxLength(maxLength) {
    this._maxLength = maxLength;
    const currentValue = this.plainText;
    if (currentValue.length > maxLength) {
      this.setText(truncateInput(currentValue, maxLength));
    }
  }
  get maxLength() {
    return this._maxLength;
  }
  set minLength(minLength) {
    if (minLength > this._maxLength) {
      throw new Error(`InputRenderable: minLength (${minLength}) cannot be greater than maxLength (${this._maxLength})`);
    }
    this._minLength = minLength;
  }
  get minLength() {
    return this._minLength;
  }
  set placeholder(placeholder) {
    super.placeholder = placeholder;
  }
  get placeholder() {
    const p = super.placeholder;
    return typeof p === "string" ? p : "";
  }
  set initialValue(value) {
  }
};

// src/renderables/Markdown.ts
import { Lexer as Lexer2 } from "marked";

// src/lib/table-columns.ts
function normalizeColumnWidth(width) {
  return Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
}
function sumWidths(widths) {
  let total = 0;
  for (const width of widths) total += width;
  return total;
}
function allocateShrinkByWeight(shrinkable, targetShrink, mode) {
  const shrink = new Array(shrinkable.length).fill(0);
  if (targetShrink <= 0) {
    return shrink;
  }
  const weights = shrinkable.map((value) => {
    if (value <= 0) {
      return 0;
    }
    return mode === "sqrt" ? Math.sqrt(value) : value;
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) {
    return shrink;
  }
  const fractions = new Array(shrinkable.length).fill(0);
  let usedShrink = 0;
  for (let idx = 0; idx < shrinkable.length; idx++) {
    if (shrinkable[idx] <= 0 || weights[idx] <= 0) continue;
    const exact = weights[idx] / totalWeight * targetShrink;
    const whole = Math.min(shrinkable[idx], Math.floor(exact));
    shrink[idx] = whole;
    fractions[idx] = exact - whole;
    usedShrink += whole;
  }
  let remainingShrink = targetShrink - usedShrink;
  while (remainingShrink > 0) {
    let bestIdx = -1;
    let bestFraction = -1;
    for (let idx = 0; idx < shrinkable.length; idx++) {
      if (shrinkable[idx] - shrink[idx] <= 0) continue;
      if (bestIdx === -1 || fractions[idx] > bestFraction || fractions[idx] === bestFraction && shrinkable[idx] > shrinkable[bestIdx]) {
        bestIdx = idx;
        bestFraction = fractions[idx];
      }
    }
    if (bestIdx === -1) {
      break;
    }
    shrink[bestIdx] += 1;
    fractions[bestIdx] = 0;
    remainingShrink -= 1;
  }
  return shrink;
}
function fitColumnWidthsProportional(widths, targetContentWidth, minWidth, columnMinWidths) {
  const hardMinWidths = widths.map((_, idx) => Math.max(minWidth, columnMinWidths?.[idx] ?? minWidth));
  const baseWidths = widths.map(normalizeColumnWidth);
  const preferredMinWidths = baseWidths.map(
    (width, idx) => Math.min(width, Math.max(minWidth + 1, hardMinWidths[idx]))
  );
  const preferredMinTotal = sumWidths(preferredMinWidths);
  const floorWidths = preferredMinTotal <= targetContentWidth ? preferredMinWidths : hardMinWidths;
  const floorTotal = sumWidths(floorWidths);
  const clampedTarget = Math.max(floorTotal, targetContentWidth);
  const totalBaseWidth = sumWidths(baseWidths);
  if (totalBaseWidth <= clampedTarget) {
    return baseWidths;
  }
  const shrinkable = baseWidths.map((width, idx) => width - floorWidths[idx]);
  const totalShrinkable = sumWidths(shrinkable);
  if (totalShrinkable <= 0) {
    return [...floorWidths];
  }
  const targetShrink = totalBaseWidth - clampedTarget;
  const integerShrink = new Array(baseWidths.length).fill(0);
  const fractions = new Array(baseWidths.length).fill(0);
  let usedShrink = 0;
  for (let idx = 0; idx < baseWidths.length; idx++) {
    if (shrinkable[idx] <= 0) continue;
    const exact = shrinkable[idx] / totalShrinkable * targetShrink;
    const whole = Math.min(shrinkable[idx], Math.floor(exact));
    integerShrink[idx] = whole;
    fractions[idx] = exact - whole;
    usedShrink += whole;
  }
  let remainingShrink = targetShrink - usedShrink;
  while (remainingShrink > 0) {
    let bestIdx = -1;
    let bestFraction = -1;
    for (let idx = 0; idx < baseWidths.length; idx++) {
      if (shrinkable[idx] - integerShrink[idx] <= 0) continue;
      if (fractions[idx] > bestFraction) {
        bestFraction = fractions[idx];
        bestIdx = idx;
      }
    }
    if (bestIdx === -1) break;
    integerShrink[bestIdx] += 1;
    fractions[bestIdx] = 0;
    remainingShrink -= 1;
  }
  return baseWidths.map((width, idx) => Math.max(floorWidths[idx], width - integerShrink[idx]));
}
function fitColumnWidthsBalanced(widths, targetContentWidth, minWidth, columnMinWidths) {
  const hardMinWidths = widths.map((_, idx) => Math.max(minWidth, columnMinWidths?.[idx] ?? minWidth));
  const baseWidths = widths.map(normalizeColumnWidth);
  const totalBaseWidth = sumWidths(baseWidths);
  const columns = baseWidths.length;
  if (columns === 0 || totalBaseWidth <= targetContentWidth) {
    return baseWidths;
  }
  const evenShare = Math.max(minWidth, Math.floor(targetContentWidth / columns));
  const preferredMinWidths = baseWidths.map(
    (width, idx) => Math.min(width, Math.max(evenShare, hardMinWidths[idx]))
  );
  const preferredMinTotal = sumWidths(preferredMinWidths);
  const floorWidths = preferredMinTotal <= targetContentWidth ? preferredMinWidths : hardMinWidths;
  const floorTotal = sumWidths(floorWidths);
  const clampedTarget = Math.max(floorTotal, targetContentWidth);
  if (totalBaseWidth <= clampedTarget) {
    return baseWidths;
  }
  const shrinkable = baseWidths.map((width, idx) => width - floorWidths[idx]);
  const totalShrinkable = sumWidths(shrinkable);
  if (totalShrinkable <= 0) {
    return [...floorWidths];
  }
  const targetShrink = totalBaseWidth - clampedTarget;
  const shrink = allocateShrinkByWeight(shrinkable, targetShrink, "sqrt");
  return baseWidths.map((width, idx) => Math.max(floorWidths[idx], width - shrink[idx]));
}

// src/renderables/TextTable.ts
var cellSegmenter = new Intl.Segmenter(void 0, { granularity: "grapheme" });
function maxGraphemeWidth(content) {
  let width = 0;
  for (const chunk of content ?? []) {
    for (const { segment } of cellSegmenter.segment(chunk.text)) {
      if (segment === "\n") continue;
      width = Math.max(width, stringWidth(segment));
    }
  }
  return width;
}
var MEASURE_HEIGHT = 1e4;
var TextTableRenderable = class extends Renderable {
  _content;
  _wrapMode;
  _columnWidthMode;
  _columnFitter;
  _cellPaddingX;
  _cellPaddingY;
  _columnGap;
  _showBorders;
  _border;
  _outerBorder;
  _hasExplicitOuterBorder;
  _borderStyle;
  _borderColor;
  _borderBackgroundColor;
  _backgroundColor;
  _defaultFg;
  _defaultBg;
  _defaultAttributes;
  _selectionBg;
  _selectionFg;
  _lastLocalSelection = null;
  _lastSelectionMode = null;
  _cells = [];
  _prevCellContent = [];
  _rowCount = 0;
  _columnCount = 0;
  _layout = this.createEmptyLayout();
  _layoutDirty = true;
  _rasterDirty = true;
  _cachedMeasureLayout = null;
  _cachedMeasureWidth = void 0;
  _defaultOptions = {
    content: [],
    wrapMode: "word",
    columnWidthMode: "full",
    columnFitter: "proportional",
    cellPadding: 0,
    cellPaddingX: void 0,
    cellPaddingY: void 0,
    columnGap: 0,
    showBorders: true,
    border: true,
    outerBorder: true,
    selectable: true,
    selectionBg: void 0,
    selectionFg: void 0,
    borderStyle: "single",
    borderColor: "#FFFFFF",
    borderBackgroundColor: "transparent",
    backgroundColor: "transparent",
    fg: "#FFFFFF",
    bg: "transparent",
    attributes: 0
  };
  constructor(ctx, options = {}) {
    super(ctx, { ...options, flexShrink: options.flexShrink ?? 0, buffered: true });
    this._content = options.content ?? this._defaultOptions.content;
    this._wrapMode = options.wrapMode ?? this._defaultOptions.wrapMode;
    this._columnWidthMode = options.columnWidthMode ?? this._defaultOptions.columnWidthMode;
    this._columnFitter = this.resolveColumnFitter(options.columnFitter);
    this._cellPaddingX = this.resolveCellPadding(options.cellPaddingX ?? options.cellPadding);
    this._cellPaddingY = this.resolveCellPadding(options.cellPaddingY ?? options.cellPadding);
    this._columnGap = this.resolveColumnGap(options.columnGap);
    this._showBorders = options.showBorders ?? this._defaultOptions.showBorders;
    this._border = options.border ?? this._defaultOptions.border;
    this._hasExplicitOuterBorder = options.outerBorder !== void 0;
    this._outerBorder = options.outerBorder ?? this._border;
    this.selectable = options.selectable ?? this._defaultOptions.selectable;
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : void 0;
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : void 0;
    this._borderStyle = parseBorderStyle(options.borderStyle, this._defaultOptions.borderStyle);
    this._borderColor = parseColor(options.borderColor ?? this._defaultOptions.borderColor);
    this._borderBackgroundColor = parseColor(
      options.borderBackgroundColor ?? this._defaultOptions.borderBackgroundColor
    );
    this._backgroundColor = parseColor(options.backgroundColor ?? this._defaultOptions.backgroundColor);
    this._defaultFg = parseColor(options.fg ?? this._defaultOptions.fg);
    this._defaultBg = parseColor(options.bg ?? this._defaultOptions.bg);
    this._defaultAttributes = options.attributes ?? this._defaultOptions.attributes;
    this.setupMeasureFunc();
    this.rebuildCells();
  }
  get content() {
    return this._content;
  }
  set content(value) {
    this._content = value ?? [];
    this.rebuildCells();
  }
  get wrapMode() {
    return this._wrapMode;
  }
  set wrapMode(value) {
    if (this._wrapMode === value) return;
    this._wrapMode = value;
    for (const row of this._cells) {
      for (const cell of row) {
        cell.textBufferView.setWrapMode(value);
      }
    }
    this.invalidateLayoutAndRaster();
  }
  get columnWidthMode() {
    return this._columnWidthMode;
  }
  set columnWidthMode(value) {
    if (this._columnWidthMode === value) return;
    this._columnWidthMode = value;
    this.invalidateLayoutAndRaster();
  }
  get columnFitter() {
    return this._columnFitter;
  }
  set columnFitter(value) {
    const next = this.resolveColumnFitter(value);
    if (this._columnFitter === next) return;
    this._columnFitter = next;
    this.invalidateLayoutAndRaster();
  }
  get cellPadding() {
    return this._cellPaddingX === this._cellPaddingY ? this._cellPaddingX : 0;
  }
  set cellPadding(value) {
    const next = this.resolveCellPadding(value);
    if (this._cellPaddingX === next && this._cellPaddingY === next) return;
    this._cellPaddingX = next;
    this._cellPaddingY = next;
    this.invalidateLayoutAndRaster();
  }
  get cellPaddingX() {
    return this._cellPaddingX;
  }
  set cellPaddingX(value) {
    const next = this.resolveCellPadding(value);
    if (this._cellPaddingX === next) return;
    this._cellPaddingX = next;
    this.invalidateLayoutAndRaster();
  }
  get cellPaddingY() {
    return this._cellPaddingY;
  }
  set cellPaddingY(value) {
    const next = this.resolveCellPadding(value);
    if (this._cellPaddingY === next) return;
    this._cellPaddingY = next;
    this.invalidateLayoutAndRaster();
  }
  get columnGap() {
    return this._columnGap;
  }
  set columnGap(value) {
    const next = this.resolveColumnGap(value);
    if (this._columnGap === next) return;
    this._columnGap = next;
    this.invalidateLayoutAndRaster();
  }
  get showBorders() {
    return this._showBorders;
  }
  set showBorders(value) {
    if (this._showBorders === value) return;
    this._showBorders = value;
    this.invalidateRasterOnly();
  }
  get outerBorder() {
    return this._outerBorder;
  }
  set outerBorder(value) {
    if (this._outerBorder === value) return;
    this._hasExplicitOuterBorder = true;
    this._outerBorder = value;
    this.invalidateLayoutAndRaster();
  }
  get border() {
    return this._border;
  }
  set border(value) {
    if (this._border === value) return;
    this._border = value;
    if (!this._hasExplicitOuterBorder) {
      this._outerBorder = value;
    }
    this.invalidateLayoutAndRaster();
  }
  get borderStyle() {
    return this._borderStyle;
  }
  set borderStyle(value) {
    const next = parseBorderStyle(value, this._defaultOptions.borderStyle);
    if (this._borderStyle === next) return;
    this._borderStyle = next;
    this.invalidateRasterOnly();
  }
  get borderColor() {
    return this._borderColor;
  }
  set borderColor(value) {
    const next = parseColor(value);
    if (this._borderColor === next) return;
    this._borderColor = next;
    this.invalidateRasterOnly();
  }
  shouldStartSelection(x, y) {
    if (!this.selectable) return false;
    this.ensureLayoutReady();
    const localX = x - this.x;
    const localY = y - this.y;
    return this.getCellAtLocalPosition(localX, localY) !== null;
  }
  onSelectionChanged(selection) {
    this.ensureLayoutReady();
    const previousLocalSelection = this._lastLocalSelection;
    const localSelection = convertGlobalToLocalSelection(selection, this.x, this.y);
    this._lastLocalSelection = localSelection;
    const dirtyRows = this.getDirtySelectionRowRange(previousLocalSelection, localSelection);
    if (!localSelection?.isActive) {
      this.resetCellSelections();
      this._lastSelectionMode = null;
    } else {
      this.applySelectionToCells(localSelection, selection?.isStart ?? false);
    }
    if (dirtyRows !== null) {
      this.redrawSelectionRows(dirtyRows.firstRow, dirtyRows.lastRow);
    }
    return this.hasSelection();
  }
  hasSelection() {
    for (const row of this._cells) {
      for (const cell of row) {
        if (cell.textBufferView.hasSelection()) {
          return true;
        }
      }
    }
    return false;
  }
  getSelection() {
    for (const row of this._cells) {
      for (const cell of row) {
        const selection = cell.textBufferView.getSelection();
        if (selection) {
          return selection;
        }
      }
    }
    return null;
  }
  getSelectedText() {
    const selectedRows = [];
    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      const rowSelections = [];
      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx];
        if (!cell || !cell.textBufferView.hasSelection()) continue;
        const selectedText = cell.textBufferView.getSelectedText();
        if (selectedText.length > 0) {
          rowSelections.push(selectedText);
        }
      }
      if (rowSelections.length > 0) {
        selectedRows.push(rowSelections.join("	"));
      }
    }
    return selectedRows.join("\n");
  }
  onResize(width, height) {
    this.invalidateLayoutAndRaster(false);
    super.onResize(width, height);
  }
  renderSelf(buffer) {
    if (!this.visible || this.isDestroyed) return;
    if (this._layoutDirty) {
      this.rebuildLayoutForCurrentWidth();
    }
    if (!this._rasterDirty) return;
    buffer.clear(this._backgroundColor);
    if (this._rowCount === 0 || this._columnCount === 0) {
      this._rasterDirty = false;
      return;
    }
    this.drawBorders(buffer);
    this.drawCells(buffer);
    this._rasterDirty = false;
  }
  destroySelf() {
    this.destroyCells();
    super.destroySelf();
  }
  setupMeasureFunc() {
    const measureFunc = (width, widthMode, _height, _heightMode) => {
      const hasWidthConstraint = widthMode !== 0 /* Undefined */ && Number.isFinite(width);
      const rawWidthConstraint = hasWidthConstraint ? Math.max(1, Math.floor(width)) : void 0;
      const widthConstraint = this.resolveLayoutWidthConstraint(rawWidthConstraint);
      const measuredLayout = this.computeLayout(widthConstraint);
      this._cachedMeasureLayout = measuredLayout;
      this._cachedMeasureWidth = widthConstraint;
      let measuredWidth = measuredLayout.tableWidth > 0 ? measuredLayout.tableWidth : 1;
      let measuredHeight = measuredLayout.tableHeight > 0 ? measuredLayout.tableHeight : 1;
      if (widthMode === 2 /* AtMost */ && rawWidthConstraint !== void 0 && this._positionType !== "absolute") {
        measuredWidth = Math.min(rawWidthConstraint, measuredWidth);
      }
      return {
        width: measuredWidth,
        height: measuredHeight
      };
    };
    this.yogaNode.setMeasureFunc(measureFunc);
  }
  rebuildCells() {
    const newRowCount = this._content.length;
    const newColumnCount = this._content.reduce((max, row) => Math.max(max, row.length), 0);
    if (this._cells.length === 0) {
      this._rowCount = newRowCount;
      this._columnCount = newColumnCount;
      this._cells = [];
      this._prevCellContent = [];
      for (let rowIdx = 0; rowIdx < newRowCount; rowIdx++) {
        const row = this._content[rowIdx] ?? [];
        const rowCells = [];
        const rowRefs = [];
        for (let colIdx = 0; colIdx < newColumnCount; colIdx++) {
          const cellContent = row[colIdx];
          rowCells.push(this.createCell(cellContent));
          rowRefs.push(cellContent);
        }
        this._cells.push(rowCells);
        this._prevCellContent.push(rowRefs);
      }
      this.invalidateLayoutAndRaster();
      return;
    }
    this.updateCellsDiff(newRowCount, newColumnCount);
    this.invalidateLayoutAndRaster();
  }
  updateCellsDiff(newRowCount, newColumnCount) {
    const oldRowCount = this._rowCount;
    const oldColumnCount = this._columnCount;
    const keepRows = Math.min(oldRowCount, newRowCount);
    const keepCols = Math.min(oldColumnCount, newColumnCount);
    for (let rowIdx = 0; rowIdx < keepRows; rowIdx++) {
      const newRow = this._content[rowIdx] ?? [];
      const cellRow = this._cells[rowIdx];
      const refRow = this._prevCellContent[rowIdx];
      for (let colIdx = 0; colIdx < keepCols; colIdx++) {
        const cellContent = newRow[colIdx];
        if (cellContent === refRow[colIdx]) continue;
        const oldCell = cellRow[colIdx];
        oldCell.textBufferView.destroy();
        oldCell.textBuffer.destroy();
        oldCell.syntaxStyle.destroy();
        cellRow[colIdx] = this.createCell(cellContent);
        refRow[colIdx] = cellContent;
      }
      if (newColumnCount > oldColumnCount) {
        for (let colIdx = oldColumnCount; colIdx < newColumnCount; colIdx++) {
          const cellContent = newRow[colIdx];
          cellRow.push(this.createCell(cellContent));
          refRow.push(cellContent);
        }
      } else if (newColumnCount < oldColumnCount) {
        for (let colIdx = newColumnCount; colIdx < oldColumnCount; colIdx++) {
          const cell = cellRow[colIdx];
          cell.textBufferView.destroy();
          cell.textBuffer.destroy();
          cell.syntaxStyle.destroy();
        }
        cellRow.length = newColumnCount;
        refRow.length = newColumnCount;
      }
    }
    if (newRowCount > oldRowCount) {
      for (let rowIdx = oldRowCount; rowIdx < newRowCount; rowIdx++) {
        const newRow = this._content[rowIdx] ?? [];
        const rowCells = [];
        const rowRefs = [];
        for (let colIdx = 0; colIdx < newColumnCount; colIdx++) {
          const cellContent = newRow[colIdx];
          rowCells.push(this.createCell(cellContent));
          rowRefs.push(cellContent);
        }
        this._cells.push(rowCells);
        this._prevCellContent.push(rowRefs);
      }
    } else if (newRowCount < oldRowCount) {
      for (let rowIdx = newRowCount; rowIdx < oldRowCount; rowIdx++) {
        const row = this._cells[rowIdx];
        for (const cell of row) {
          cell.textBufferView.destroy();
          cell.textBuffer.destroy();
          cell.syntaxStyle.destroy();
        }
      }
      this._cells.length = newRowCount;
      this._prevCellContent.length = newRowCount;
    }
    this._rowCount = newRowCount;
    this._columnCount = newColumnCount;
  }
  createCell(content) {
    const styledText = this.toStyledText(content);
    const textBuffer = TextBuffer.create(this._ctx.widthMethod);
    const syntaxStyle = SyntaxStyle.create();
    textBuffer.setDefaultFg(this._defaultFg);
    textBuffer.setDefaultBg(this._defaultBg);
    textBuffer.setDefaultAttributes(this._defaultAttributes);
    textBuffer.setSyntaxStyle(syntaxStyle);
    textBuffer.setStyledText(styledText);
    const textBufferView = TextBufferView.create(textBuffer);
    textBufferView.setWrapMode(this._wrapMode);
    return { textBuffer, textBufferView, syntaxStyle };
  }
  toStyledText(content) {
    if (Array.isArray(content)) {
      return new StyledText(content);
    }
    if (content === null || content === void 0) {
      return stringToStyledText("");
    }
    return stringToStyledText(String(content));
  }
  destroyCells() {
    for (const row of this._cells) {
      for (const cell of row) {
        cell.textBufferView.destroy();
        cell.textBuffer.destroy();
        cell.syntaxStyle.destroy();
      }
    }
    this._cells = [];
    this._prevCellContent = [];
    this._rowCount = 0;
    this._columnCount = 0;
    this._layout = this.createEmptyLayout();
  }
  rebuildLayoutForCurrentWidth() {
    const maxTableWidth = this.resolveLayoutWidthConstraint(this.width);
    let layout;
    if (this._cachedMeasureLayout !== null && this._cachedMeasureWidth === maxTableWidth) {
      layout = this._cachedMeasureLayout;
    } else {
      layout = this.computeLayout(maxTableWidth);
    }
    this._cachedMeasureLayout = null;
    this._cachedMeasureWidth = void 0;
    this._layout = layout;
    this.applyLayoutToViews(layout);
    this._layoutDirty = false;
    if (this._lastLocalSelection?.isActive) {
      this.applySelectionToCells(this._lastLocalSelection, true);
    }
  }
  computeLayout(maxTableWidth) {
    if (this._rowCount === 0 || this._columnCount === 0) {
      return this.createEmptyLayout();
    }
    const borderLayout = this.resolveBorderLayout();
    const { widths: columnWidths, intrinsic } = this.computeColumnWidths(maxTableWidth, borderLayout);
    const rowHeights = this.computeRowHeights(columnWidths, intrinsic);
    const columnOffsets = this.computeOffsets(
      columnWidths,
      borderLayout.left,
      borderLayout.right,
      borderLayout.innerVertical,
      this.getInterColumnGap(borderLayout)
    );
    const rowOffsets = this.computeOffsets(
      rowHeights,
      borderLayout.top,
      borderLayout.bottom,
      borderLayout.innerHorizontal
    );
    return {
      columnWidths,
      rowHeights,
      columnOffsets,
      rowOffsets,
      columnOffsetsI32: new Int32Array(columnOffsets),
      rowOffsetsI32: new Int32Array(rowOffsets),
      tableWidth: (columnOffsets[columnOffsets.length - 1] ?? 0) + 1,
      tableHeight: (rowOffsets[rowOffsets.length - 1] ?? 0) + 1
    };
  }
  isFullWidthMode() {
    return this._columnWidthMode === "full";
  }
  computeColumnWidths(maxTableWidth, borderLayout) {
    const horizontalPadding = this.getHorizontalCellPadding();
    const intrinsicWidths = new Array(this._columnCount).fill(1 + horizontalPadding);
    const columnMinWidths = new Array(this._columnCount).fill(1 + horizontalPadding);
    const intrinsic = [];
    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      const rowMeasures = [];
      intrinsic.push(rowMeasures);
      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx];
        if (!cell) continue;
        const measure = cell.textBufferView.measureForDimensions(0, MEASURE_HEIGHT);
        const intrinsicCell = {
          width: Math.max(1, measure?.widthColsMax ?? 0),
          lineCount: Math.max(1, measure?.lineCount ?? 1)
        };
        rowMeasures[colIdx] = intrinsicCell;
        intrinsicWidths[colIdx] = Math.max(intrinsicWidths[colIdx], intrinsicCell.width + horizontalPadding);
        columnMinWidths[colIdx] = Math.max(
          columnMinWidths[colIdx],
          maxGraphemeWidth(this._content[rowIdx]?.[colIdx]) + horizontalPadding
        );
      }
    }
    if (maxTableWidth === void 0 || !Number.isFinite(maxTableWidth) || maxTableWidth <= 0) {
      return { widths: intrinsicWidths, intrinsic };
    }
    const maxContentWidth = Math.max(
      1,
      Math.floor(maxTableWidth) - this.getVerticalBorderCount(borderLayout) - this.getTotalInterColumnGap(borderLayout)
    );
    const currentWidth = intrinsicWidths.reduce((sum, width) => sum + width, 0);
    if (currentWidth === maxContentWidth) {
      return { widths: intrinsicWidths, intrinsic };
    }
    if (currentWidth < maxContentWidth) {
      if (this.isFullWidthMode()) {
        return { widths: this.expandColumnWidths(intrinsicWidths, maxContentWidth), intrinsic };
      }
      return { widths: intrinsicWidths, intrinsic };
    }
    if (this._wrapMode === "none") {
      return { widths: intrinsicWidths, intrinsic };
    }
    return { widths: this.fitColumnWidths(intrinsicWidths, maxContentWidth, columnMinWidths), intrinsic };
  }
  expandColumnWidths(widths, targetContentWidth) {
    const baseWidths = widths.map(normalizeColumnWidth);
    const totalBaseWidth = baseWidths.reduce((sum, width) => sum + width, 0);
    if (totalBaseWidth >= targetContentWidth) {
      return baseWidths;
    }
    const expanded = [...baseWidths];
    const columns = expanded.length;
    const extraWidth = targetContentWidth - totalBaseWidth;
    const sharedWidth = Math.floor(extraWidth / columns);
    const remainder = extraWidth % columns;
    for (let idx = 0; idx < columns; idx++) {
      expanded[idx] += sharedWidth;
      if (idx < remainder) {
        expanded[idx] += 1;
      }
    }
    return expanded;
  }
  fitColumnWidths(widths, targetContentWidth, columnMinWidths) {
    const minWidth = 1 + this.getHorizontalCellPadding();
    if (this._columnFitter === "balanced") {
      return fitColumnWidthsBalanced(widths, targetContentWidth, minWidth, columnMinWidths);
    }
    return fitColumnWidthsProportional(widths, targetContentWidth, minWidth, columnMinWidths);
  }
  computeRowHeights(columnWidths, intrinsic) {
    const horizontalPadding = this.getHorizontalCellPadding();
    const verticalPadding = this.getVerticalCellPadding();
    const rowHeights = new Array(this._rowCount).fill(1 + verticalPadding);
    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx];
        if (!cell) continue;
        const contentWidth = Math.max(1, (columnWidths[colIdx] ?? 1) - horizontalPadding);
        const intrinsicCell = intrinsic[rowIdx]?.[colIdx];
        let lineCount;
        if (intrinsicCell && intrinsicCell.width <= contentWidth) {
          lineCount = intrinsicCell.lineCount;
        } else {
          const measure = cell.textBufferView.measureForDimensions(contentWidth, MEASURE_HEIGHT);
          lineCount = Math.max(1, measure?.lineCount ?? 1);
        }
        rowHeights[rowIdx] = Math.max(rowHeights[rowIdx], lineCount + verticalPadding);
      }
    }
    return rowHeights;
  }
  computeOffsets(parts, startBoundary, endBoundary, includeInnerBoundaries, innerGap = 0) {
    const offsets = [startBoundary ? 0 : -1];
    let cursor = offsets[0] ?? 0;
    for (let idx = 0; idx < parts.length; idx++) {
      const size = parts[idx] ?? 1;
      const separatorAfter = idx < parts.length - 1 ? includeInnerBoundaries ? 1 : innerGap : endBoundary ? 1 : 0;
      cursor += size + separatorAfter;
      offsets.push(cursor);
    }
    return offsets;
  }
  getInterColumnGap(borderLayout) {
    if (borderLayout.innerVertical) {
      return 0;
    }
    return this._columnGap;
  }
  getTotalInterColumnGap(borderLayout) {
    return Math.max(0, this._columnCount - 1) * this.getInterColumnGap(borderLayout);
  }
  applyLayoutToViews(layout) {
    const horizontalPadding = this.getHorizontalCellPadding();
    const verticalPadding = this.getVerticalCellPadding();
    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx];
        if (!cell) continue;
        const colWidth = layout.columnWidths[colIdx] ?? 1;
        const rowHeight = layout.rowHeights[rowIdx] ?? 1;
        const contentWidth = Math.max(1, colWidth - horizontalPadding);
        const contentHeight = Math.max(1, rowHeight - verticalPadding);
        if (this._wrapMode === "none") {
          cell.textBufferView.setWrapWidth(null);
        } else {
          cell.textBufferView.setWrapWidth(contentWidth);
        }
        cell.textBufferView.setViewport(0, 0, contentWidth, contentHeight);
      }
    }
  }
  resolveBorderLayout() {
    return {
      left: this._outerBorder,
      right: this._outerBorder,
      top: this._outerBorder,
      bottom: this._outerBorder,
      innerVertical: this._border && this._columnCount > 1,
      innerHorizontal: this._border && this._rowCount > 1
    };
  }
  getVerticalBorderCount(borderLayout) {
    return (borderLayout.left ? 1 : 0) + (borderLayout.right ? 1 : 0) + (borderLayout.innerVertical ? Math.max(0, this._columnCount - 1) : 0);
  }
  getHorizontalBorderCount(borderLayout) {
    return (borderLayout.top ? 1 : 0) + (borderLayout.bottom ? 1 : 0) + (borderLayout.innerHorizontal ? Math.max(0, this._rowCount - 1) : 0);
  }
  drawBorders(buffer) {
    if (!this._showBorders) {
      return;
    }
    const borderLayout = this.resolveBorderLayout();
    if (this.getVerticalBorderCount(borderLayout) === 0 && this.getHorizontalBorderCount(borderLayout) === 0) {
      return;
    }
    buffer.drawGrid({
      borderChars: BorderCharArrays[this._borderStyle],
      borderFg: this._borderColor,
      borderBg: this._borderBackgroundColor,
      columnOffsets: this._layout.columnOffsetsI32,
      rowOffsets: this._layout.rowOffsetsI32,
      drawInner: this._border,
      drawOuter: this._outerBorder
    });
  }
  drawCells(buffer) {
    this.drawCellRange(buffer, 0, this._rowCount - 1);
  }
  drawCellRange(buffer, firstRow, lastRow) {
    const colOffsets = this._layout.columnOffsets;
    const rowOffsets = this._layout.rowOffsets;
    const cellPaddingX = this._cellPaddingX;
    const cellPaddingY = this._cellPaddingY;
    for (let rowIdx = firstRow; rowIdx <= lastRow; rowIdx++) {
      const cellY = (rowOffsets[rowIdx] ?? 0) + 1 + cellPaddingY;
      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx];
        if (!cell) continue;
        buffer.drawTextBuffer(cell.textBufferView, (colOffsets[colIdx] ?? 0) + 1 + cellPaddingX, cellY);
      }
    }
  }
  redrawSelectionRows(firstRow, lastRow) {
    if (firstRow > lastRow) return;
    if (this._backgroundColor.a < 1) {
      this.invalidateRasterOnly();
      return;
    }
    const buffer = this.frameBuffer;
    if (!buffer) return;
    this.clearCellRange(buffer, firstRow, lastRow);
    this.drawCellRange(buffer, firstRow, lastRow);
    this.requestRender();
  }
  clearCellRange(buffer, firstRow, lastRow) {
    const colWidths = this._layout.columnWidths;
    const rowHeights = this._layout.rowHeights;
    const colOffsets = this._layout.columnOffsets;
    const rowOffsets = this._layout.rowOffsets;
    for (let rowIdx = firstRow; rowIdx <= lastRow; rowIdx++) {
      const cellY = (rowOffsets[rowIdx] ?? 0) + 1;
      const rowHeight = rowHeights[rowIdx] ?? 1;
      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cellX = (colOffsets[colIdx] ?? 0) + 1;
        const colWidth = colWidths[colIdx] ?? 1;
        if (this._backgroundColor.a < 1) {
          for (let y = cellY; y < cellY + rowHeight; y++) {
            for (let x = cellX; x < cellX + colWidth; x++) {
              buffer.setCell(x, y, " ", this._defaultFg, this._backgroundColor, this._defaultAttributes);
            }
          }
        } else {
          buffer.fillRect(cellX, cellY, colWidth, rowHeight, this._backgroundColor);
        }
      }
    }
  }
  ensureLayoutReady() {
    if (!this._layoutDirty) return;
    this.rebuildLayoutForCurrentWidth();
  }
  getCellAtLocalPosition(localX, localY) {
    if (this._rowCount === 0 || this._columnCount === 0) return null;
    if (localX < 0 || localY < 0 || localX >= this._layout.tableWidth || localY >= this._layout.tableHeight) {
      return null;
    }
    let rowIdx = -1;
    for (let idx = 0; idx < this._rowCount; idx++) {
      const top = (this._layout.rowOffsets[idx] ?? 0) + 1;
      const bottom = top + (this._layout.rowHeights[idx] ?? 1) - 1;
      if (localY >= top && localY <= bottom) {
        rowIdx = idx;
        break;
      }
    }
    if (rowIdx < 0) return null;
    let colIdx = -1;
    for (let idx = 0; idx < this._columnCount; idx++) {
      const left = (this._layout.columnOffsets[idx] ?? 0) + 1;
      const right = left + (this._layout.columnWidths[idx] ?? 1) - 1;
      if (localX >= left && localX <= right) {
        colIdx = idx;
        break;
      }
    }
    if (colIdx < 0) return null;
    return { rowIdx, colIdx };
  }
  applySelectionToCells(localSelection, isStart) {
    if (localSelection.anchorX === localSelection.focusX && localSelection.anchorY === localSelection.focusY) {
      this.resetCellSelections();
      this._lastSelectionMode = null;
      return;
    }
    const minSelY = Math.min(localSelection.anchorY, localSelection.focusY);
    const maxSelY = Math.max(localSelection.anchorY, localSelection.focusY);
    const firstRow = this.findRowForLocalY(minSelY);
    const lastRow = this.findRowForLocalY(maxSelY);
    const selection = this.resolveSelectionResolution(localSelection);
    const modeChanged = this._lastSelectionMode !== selection.mode;
    this._lastSelectionMode = selection.mode;
    const lockToAnchorColumn = selection.mode === "column-locked" && selection.anchorColumn !== null;
    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      if (rowIdx < firstRow || rowIdx > lastRow) {
        this.resetRowSelection(rowIdx);
        continue;
      }
      const cellTop = (this._layout.rowOffsets[rowIdx] ?? 0) + 1 + this._cellPaddingY;
      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx];
        if (!cell) continue;
        if (lockToAnchorColumn && colIdx !== selection.anchorColumn) {
          cell.textBufferView.resetLocalSelection();
          continue;
        }
        const cellLeft = (this._layout.columnOffsets[colIdx] ?? 0) + 1 + this._cellPaddingX;
        let coords = {
          anchorX: localSelection.anchorX - cellLeft,
          anchorY: localSelection.anchorY - cellTop,
          focusX: localSelection.focusX - cellLeft,
          focusY: localSelection.focusY - cellTop
        };
        const isAnchorCell = selection.anchorCell !== null && selection.anchorCell.rowIdx === rowIdx && selection.anchorCell.colIdx === colIdx;
        if (selection.mode === "single-cell" && !isAnchorCell) {
          cell.textBufferView.resetLocalSelection();
          continue;
        }
        const forceSet = isAnchorCell && selection.mode !== "single-cell";
        if (forceSet) {
          coords = this.getFullCellSelectionCoords(rowIdx, colIdx);
        }
        const shouldUseSet = isStart || modeChanged || forceSet;
        if (shouldUseSet) {
          cell.textBufferView.setLocalSelection(
            coords.anchorX,
            coords.anchorY,
            coords.focusX,
            coords.focusY,
            this._selectionBg,
            this._selectionFg
          );
        } else {
          cell.textBufferView.updateLocalSelection(
            coords.anchorX,
            coords.anchorY,
            coords.focusX,
            coords.focusY,
            this._selectionBg,
            this._selectionFg
          );
        }
      }
    }
  }
  resolveSelectionResolution(localSelection) {
    const anchorCell = this.getCellAtLocalPosition(localSelection.anchorX, localSelection.anchorY);
    const focusCell = this.getCellAtLocalPosition(localSelection.focusX, localSelection.focusY);
    const anchorColumn = anchorCell?.colIdx ?? this.getColumnAtLocalX(localSelection.anchorX);
    if (anchorCell !== null && focusCell !== null && anchorCell.rowIdx === focusCell.rowIdx && anchorCell.colIdx === focusCell.colIdx) {
      return {
        mode: "single-cell",
        anchorCell,
        anchorColumn
      };
    }
    const focusColumn = this.getColumnAtLocalX(localSelection.focusX);
    if (anchorColumn !== null && focusColumn === anchorColumn) {
      return {
        mode: "column-locked",
        anchorCell,
        anchorColumn
      };
    }
    return {
      mode: "grid",
      anchorCell,
      anchorColumn
    };
  }
  getColumnAtLocalX(localX) {
    if (this._columnCount === 0) return null;
    if (localX < 0 || localX >= this._layout.tableWidth) return null;
    for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
      const colStart = (this._layout.columnOffsets[colIdx] ?? 0) + 1;
      const colEnd = colStart + (this._layout.columnWidths[colIdx] ?? 1) - 1;
      if (localX >= colStart && localX <= colEnd) {
        return colIdx;
      }
    }
    return null;
  }
  getFullCellSelectionCoords(rowIdx, colIdx) {
    const colWidth = this._layout.columnWidths[colIdx] ?? 1;
    const rowHeight = this._layout.rowHeights[rowIdx] ?? 1;
    const contentWidth = Math.max(1, colWidth - this.getHorizontalCellPadding());
    const contentHeight = Math.max(1, rowHeight - this.getVerticalCellPadding());
    return {
      anchorX: -1,
      anchorY: 0,
      focusX: contentWidth,
      focusY: contentHeight
    };
  }
  findRowForLocalY(localY) {
    if (this._rowCount === 0) return 0;
    if (localY < 0) return 0;
    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      const rowStart = (this._layout.rowOffsets[rowIdx] ?? 0) + 1;
      const rowEnd = rowStart + (this._layout.rowHeights[rowIdx] ?? 1) - 1;
      if (localY <= rowEnd) return rowIdx;
    }
    return this._rowCount - 1;
  }
  getSelectionRowRange(selection) {
    if (!selection?.isActive || this._rowCount === 0) return null;
    const minSelY = Math.min(selection.anchorY, selection.focusY);
    const maxSelY = Math.max(selection.anchorY, selection.focusY);
    return {
      firstRow: this.findRowForLocalY(minSelY),
      lastRow: this.findRowForLocalY(maxSelY)
    };
  }
  getDirtySelectionRowRange(previousSelection, currentSelection) {
    const previousRange = this.getSelectionRowRange(previousSelection);
    const currentRange = this.getSelectionRowRange(currentSelection);
    if (previousRange === null) return currentRange;
    if (currentRange === null) return previousRange;
    return {
      firstRow: Math.min(previousRange.firstRow, currentRange.firstRow),
      lastRow: Math.max(previousRange.lastRow, currentRange.lastRow)
    };
  }
  resetRowSelection(rowIdx) {
    const row = this._cells[rowIdx];
    if (!row) return;
    for (const cell of row) {
      cell.textBufferView.resetLocalSelection();
    }
  }
  resetCellSelections() {
    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      this.resetRowSelection(rowIdx);
    }
  }
  createEmptyLayout() {
    return {
      columnWidths: [],
      rowHeights: [],
      columnOffsets: [0],
      rowOffsets: [0],
      columnOffsetsI32: new Int32Array([0]),
      rowOffsetsI32: new Int32Array([0]),
      tableWidth: 0,
      tableHeight: 0
    };
  }
  resolveLayoutWidthConstraint(width) {
    if (width === void 0 || !Number.isFinite(width) || width <= 0) {
      return void 0;
    }
    if (this._wrapMode !== "none" || this.isFullWidthMode()) {
      return Math.max(1, Math.floor(width));
    }
    return void 0;
  }
  getHorizontalCellPadding() {
    return this._cellPaddingX * 2;
  }
  getVerticalCellPadding() {
    return this._cellPaddingY * 2;
  }
  resolveColumnFitter(value) {
    if (value === void 0) {
      return this._defaultOptions.columnFitter;
    }
    return value === "balanced" ? "balanced" : "proportional";
  }
  resolveCellPadding(value) {
    if (value === void 0 || !Number.isFinite(value)) {
      return this._defaultOptions.cellPadding;
    }
    return Math.max(0, Math.floor(value));
  }
  resolveColumnGap(value) {
    if (value === void 0 || !Number.isFinite(value)) {
      return this._defaultOptions.columnGap;
    }
    return Math.max(0, Math.floor(value));
  }
  invalidateLayoutAndRaster(markYogaDirty = true) {
    this._layoutDirty = true;
    this._rasterDirty = true;
    this._cachedMeasureLayout = null;
    this._cachedMeasureWidth = void 0;
    if (markYogaDirty) {
      this.yogaNode.markDirty();
    }
    this.requestRender();
  }
  invalidateRasterOnly() {
    this._rasterDirty = true;
    this.requestRender();
  }
};

// src/renderables/markdown-parser.ts
import { Lexer } from "marked";
function parseMarkdownIncremental(newContent, prevState, trailingUnstable = 2) {
  if (!prevState || prevState.tokens.length === 0) {
    try {
      const tokens = Lexer.lex(newContent, { gfm: true });
      return {
        content: newContent,
        tokens,
        stableTokenCount: Math.max(0, tokens.length - trailingUnstable)
      };
    } catch {
      return { content: newContent, tokens: [], stableTokenCount: 0 };
    }
  }
  let offset = 0;
  let reuseCount = 0;
  for (const token of prevState.tokens) {
    const tokenLength = token.raw.length;
    if (offset + tokenLength <= newContent.length && newContent.startsWith(token.raw, offset)) {
      reuseCount++;
      offset += tokenLength;
    } else {
      break;
    }
  }
  reuseCount = Math.max(0, reuseCount - trailingUnstable);
  offset = 0;
  for (let i = 0; i < reuseCount; i++) {
    offset += prevState.tokens[i].raw.length;
  }
  const stableTokens = prevState.tokens.slice(0, reuseCount);
  const remainingContent = newContent.slice(offset);
  if (!remainingContent) {
    return {
      content: newContent,
      tokens: stableTokens,
      stableTokenCount: stableTokens.length
    };
  }
  try {
    const newTokens = Lexer.lex(remainingContent, { gfm: true });
    return {
      content: newContent,
      tokens: [...stableTokens, ...newTokens],
      stableTokenCount: trailingUnstable === 0 ? stableTokens.length + newTokens.length : stableTokens.length
    };
  } catch {
    try {
      const fullTokens = Lexer.lex(newContent, { gfm: true });
      return { content: newContent, tokens: fullTokens, stableTokenCount: 0 };
    } catch {
      return { content: newContent, tokens: [], stableTokenCount: 0 };
    }
  }
}

// src/renderables/Markdown.ts
function normalizeMarkdownCodeBlockRenderers(renderers) {
  const rendererMap = /* @__PURE__ */ new Map();
  const maybeMap = renderers;
  if (typeof maybeMap.forEach === "function") {
    maybeMap.forEach((renderer, language) => {
      rendererMap.set(language, renderer);
    });
    return rendererMap;
  }
  const rendererRecord = renderers;
  for (const [language, renderer] of Object.entries(rendererRecord)) {
    rendererMap.set(language, renderer);
  }
  return rendererMap;
}
function createMarkdownCodeBlockRenderer(renderers) {
  const rendererMap = normalizeMarkdownCodeBlockRenderers(renderers);
  const renderNode = (token, context) => {
    if (token.type !== "code") {
      return void 0;
    }
    const language = infoStringToFiletype(token.lang ?? "");
    if (!language) return void 0;
    return rendererMap.get(language)?.(token, context);
  };
  renderNode.codeBlockOnly = true;
  return renderNode;
}
function findTrailingBreakRun(raw) {
  let end = raw.length;
  let breaks = 0;
  while (end > 0 && raw[end - 1] === "\n") {
    end--;
    if (end > 0 && raw[end - 1] === "\r") end--;
    breaks++;
  }
  return { end, breaks };
}
function endsWithMarkdownBlockNewline(raw) {
  return findTrailingBreakRun(raw).breaks >= 1;
}
function endsWithMarkdownBlockBreak(raw) {
  return findTrailingBreakRun(raw).breaks >= 2;
}
function collapseTrailingMarkdownBlockBreaks(raw) {
  const { end, breaks } = findTrailingBreakRun(raw);
  return breaks >= 2 ? raw.slice(0, end) + "\n" : raw;
}
function stripTrailingMarkdownBlockNewlines(raw) {
  return raw.slice(0, findTrailingBreakRun(raw).end);
}
function colorsEqual(left, right) {
  if (!left || !right) return left === right;
  return left.equals(right);
}
var MarkdownRenderable = class extends Renderable {
  _content = "";
  _syntaxStyle;
  _fg;
  _bg;
  _conceal;
  _concealCode;
  _treeSitterClient;
  _tableOptions;
  _renderNode;
  _internalBlockMode;
  _parseState = null;
  _streaming = false;
  _blockStates = [];
  _stableBlockCount = 0;
  _styleDirty = false;
  _linkifyMarkdownChunks = (chunks, context) => detectLinks(chunks, {
    content: context.content,
    highlights: context.highlights
  });
  _contentDefaultOptions = {
    content: "",
    conceal: true,
    concealCode: false,
    streaming: false,
    internalBlockMode: "coalesced"
  };
  constructor(ctx, options) {
    super(ctx, {
      ...options,
      flexDirection: "column",
      flexShrink: options.flexShrink ?? 0
    });
    this._syntaxStyle = options.syntaxStyle;
    this._fg = options.fg ? parseColor(options.fg) : void 0;
    this._bg = options.bg ? parseColor(options.bg) : void 0;
    this._conceal = options.conceal ?? this._contentDefaultOptions.conceal;
    this._concealCode = options.concealCode ?? this._contentDefaultOptions.concealCode;
    this._content = options.content ?? this._contentDefaultOptions.content;
    this._treeSitterClient = options.treeSitterClient;
    this._tableOptions = options.tableOptions;
    this._renderNode = options.renderNode;
    this._streaming = options.streaming ?? this._contentDefaultOptions.streaming;
    this._internalBlockMode = options.internalBlockMode ?? this._contentDefaultOptions.internalBlockMode;
    this.updateBlocks();
  }
  get content() {
    return this._content;
  }
  set content(value) {
    if (this.isDestroyed) return;
    if (this._content !== value) {
      this._content = value;
      this.updateBlocks();
      this.requestRender();
    }
  }
  get syntaxStyle() {
    return this._syntaxStyle;
  }
  set syntaxStyle(value) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value;
      this._styleDirty = true;
    }
  }
  get fg() {
    return this._fg;
  }
  set fg(value) {
    const next = value ? parseColor(value) : void 0;
    if (!colorsEqual(this._fg, next)) {
      this._fg = next;
      this._styleDirty = true;
    }
  }
  get bg() {
    return this._bg;
  }
  set bg(value) {
    const next = value ? parseColor(value) : void 0;
    if (!colorsEqual(this._bg, next)) {
      this._bg = next;
      this._styleDirty = true;
    }
  }
  get conceal() {
    return this._conceal;
  }
  set conceal(value) {
    if (this._conceal !== value) {
      this._conceal = value;
      this._styleDirty = true;
    }
  }
  get concealCode() {
    return this._concealCode;
  }
  set concealCode(value) {
    if (this._concealCode !== value) {
      this._concealCode = value;
      this._styleDirty = true;
    }
  }
  get streaming() {
    return this._streaming;
  }
  set streaming(value) {
    if (this.isDestroyed) return;
    if (this._streaming !== value) {
      this._streaming = value;
      this.updateBlocks(true);
    }
  }
  get tableOptions() {
    return this._tableOptions;
  }
  set tableOptions(value) {
    this._tableOptions = value;
    this.applyTableOptionsToBlocks();
  }
  get renderNode() {
    return this._renderNode;
  }
  set renderNode(value) {
    if (this._renderNode === value) return;
    this._renderNode = value;
    this.clearBlockStates();
    this._parseState = null;
    this.updateBlocks(true);
    this.requestRender();
  }
  get internalBlockMode() {
    return this._internalBlockMode;
  }
  set internalBlockMode(value) {
    if (this._internalBlockMode === value) return;
    this._internalBlockMode = value;
    this.updateBlocks(true);
    this.requestRender();
  }
  getStyle(group) {
    if (!this._syntaxStyle) return void 0;
    let style = this._syntaxStyle.getStyle(group);
    if (!style && group.includes(".")) {
      const baseName = group.split(".")[0];
      style = this._syntaxStyle.getStyle(baseName);
    }
    return style;
  }
  createChunk(text, group, link2) {
    const style = this.getStyle(group) || this.getStyle("default");
    return {
      __isChunk: true,
      text,
      fg: style?.fg,
      bg: style?.bg,
      attributes: style ? createTextAttributes({
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        dim: style.dim
      }) : 0,
      link: link2
    };
  }
  createDefaultChunk(text, link2) {
    return this.createChunk(text, "default", link2);
  }
  createInitialStyledText(token) {
    if (!this._streaming) return void 0;
    const chunks = [];
    if ("tokens" in token && Array.isArray(token.tokens)) {
      this.renderInlineContent(token.tokens, chunks);
    }
    if (chunks.length === 0 && "text" in token && typeof token.text === "string") {
      this.renderInlineContent(Lexer2.lexInline(token.text), chunks);
    }
    return chunks.length > 0 ? new StyledText(chunks) : void 0;
  }
  renderInlineContent(tokens, chunks, link2) {
    for (const token of tokens) {
      this.renderInlineToken(token, chunks, link2);
    }
  }
  renderInlineToken(token, chunks, link2) {
    switch (token.type) {
      case "text":
        chunks.push(this.createDefaultChunk(token.text, link2));
        break;
      case "escape":
        chunks.push(this.createDefaultChunk(token.text, link2));
        break;
      case "codespan":
        if (this._conceal) {
          chunks.push(this.createChunk(token.text, "markup.raw", link2));
        } else {
          chunks.push(this.createChunk("`", "markup.raw", link2));
          chunks.push(this.createChunk(token.text, "markup.raw", link2));
          chunks.push(this.createChunk("`", "markup.raw", link2));
        }
        break;
      case "strong":
        if (!this._conceal) {
          chunks.push(this.createChunk("**", "markup.strong", link2));
        }
        for (const child of token.tokens) {
          this.renderInlineTokenWithStyle(child, chunks, "markup.strong", link2);
        }
        if (!this._conceal) {
          chunks.push(this.createChunk("**", "markup.strong", link2));
        }
        break;
      case "em":
        if (!this._conceal) {
          chunks.push(this.createChunk("*", "markup.italic", link2));
        }
        for (const child of token.tokens) {
          this.renderInlineTokenWithStyle(child, chunks, "markup.italic", link2);
        }
        if (!this._conceal) {
          chunks.push(this.createChunk("*", "markup.italic", link2));
        }
        break;
      case "del":
        if (!this._conceal) {
          chunks.push(this.createChunk("~~", "markup.strikethrough", link2));
        }
        for (const child of token.tokens) {
          this.renderInlineTokenWithStyle(child, chunks, "markup.strikethrough", link2);
        }
        if (!this._conceal) {
          chunks.push(this.createChunk("~~", "markup.strikethrough", link2));
        }
        break;
      case "link": {
        const linkHref = { url: token.href };
        if (this._conceal) {
          for (const child of token.tokens) {
            this.renderInlineTokenWithStyle(child, chunks, "markup.link.label", linkHref);
          }
          chunks.push(this.createChunk(" (", "markup.link", linkHref));
          chunks.push(this.createChunk(token.href, "markup.link.url", linkHref));
          chunks.push(this.createChunk(")", "markup.link", linkHref));
        } else {
          chunks.push(this.createChunk("[", "markup.link", linkHref));
          for (const child of token.tokens) {
            this.renderInlineTokenWithStyle(child, chunks, "markup.link.label", linkHref);
          }
          chunks.push(this.createChunk("](", "markup.link", linkHref));
          chunks.push(this.createChunk(token.href, "markup.link.url", linkHref));
          chunks.push(this.createChunk(")", "markup.link", linkHref));
        }
        break;
      }
      case "image": {
        const imageHref = { url: token.href };
        if (this._conceal) {
          chunks.push(this.createChunk(token.text || "image", "markup.link.label", imageHref));
        } else {
          chunks.push(this.createChunk("![", "markup.link", imageHref));
          chunks.push(this.createChunk(token.text || "", "markup.link.label", imageHref));
          chunks.push(this.createChunk("](", "markup.link", imageHref));
          chunks.push(this.createChunk(token.href, "markup.link.url", imageHref));
          chunks.push(this.createChunk(")", "markup.link", imageHref));
        }
        break;
      }
      case "br":
        chunks.push(this.createDefaultChunk("\n"));
        break;
      default:
        if ("tokens" in token && Array.isArray(token.tokens)) {
          this.renderInlineContent(token.tokens, chunks, link2);
        } else if ("text" in token && typeof token.text === "string") {
          chunks.push(this.createDefaultChunk(token.text, link2));
        }
        break;
    }
  }
  renderInlineTokenWithStyle(token, chunks, styleGroup, link2) {
    switch (token.type) {
      case "text":
        chunks.push(this.createChunk(token.text, styleGroup, link2));
        break;
      case "escape":
        chunks.push(this.createChunk(token.text, styleGroup, link2));
        break;
      case "codespan":
        if (this._conceal) {
          chunks.push(this.createChunk(token.text, "markup.raw", link2));
        } else {
          chunks.push(this.createChunk("`", "markup.raw", link2));
          chunks.push(this.createChunk(token.text, "markup.raw", link2));
          chunks.push(this.createChunk("`", "markup.raw", link2));
        }
        break;
      default:
        this.renderInlineToken(token, chunks, link2);
        break;
    }
  }
  applyMargins(renderable, marginTop, marginBottom) {
    renderable.marginTop = marginTop;
    renderable.marginBottom = marginBottom;
  }
  createMarkdownCodeRenderable(content, id, marginBottom = 0, onChunks = this._linkifyMarkdownChunks, baseHighlight, initialStyledText) {
    return new CodeRenderable(this.ctx, {
      id,
      content,
      filetype: "markdown",
      syntaxStyle: this._syntaxStyle,
      fg: this._fg,
      bg: this._bg,
      conceal: this._conceal,
      drawUnstyledText: initialStyledText !== void 0,
      streaming: true,
      initialStyledText,
      baseHighlight,
      onChunks,
      treeSitterClient: this._treeSitterClient,
      width: "100%",
      marginBottom
    });
  }
  createMarkdownTextBlock(token, raw, id, marginBottom = 0) {
    return this.createMarkdownCodeRenderable(
      raw,
      id,
      marginBottom,
      this._linkifyMarkdownChunks,
      void 0,
      this.createInitialStyledText(token)
    );
  }
  getBlockquoteContent(token) {
    return "text" in token && typeof token.text === "string" && token.text ? token.text : " ";
  }
  getBlockquoteBorderColor() {
    return this.getStyle("conceal")?.fg ?? this.getStyle("default")?.fg ?? this._fg ?? "#FFFFFF";
  }
  createBlockquoteRenderable(token, id, marginBottom = 0) {
    const renderable = new BoxRenderable(this.ctx, {
      id,
      width: "100%",
      border: ["left"],
      borderColor: this.getBlockquoteBorderColor(),
      paddingLeft: 1,
      flexShrink: 0,
      marginBottom
    });
    renderable.add(
      this.createMarkdownCodeRenderable(
        this.getBlockquoteContent(token),
        `${id}-content`,
        0,
        this._linkifyMarkdownChunks,
        "markup.quote"
      )
    );
    return renderable;
  }
  createListRenderable(token, id, marginBottom = 0) {
    const list = new BoxRenderable(this.ctx, {
      id,
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
      marginBottom
    });
    for (const item of this.getListItemInputs(token, id)) {
      list.add(this.createListItemRenderable(item));
    }
    return list;
  }
  getListItemInputs(token, id) {
    const items = token.items ?? [];
    const start = token.start === "" || token.start === void 0 || token.start === null ? 1 : Number(token.start);
    const markerWidth = Math.max(1, ...items.map((_, index) => (token.ordered ? `${start + index}.` : "-").length));
    return items.map((item, index) => ({
      item,
      marker: token.ordered ? `${start + index}.` : "-",
      markerWidth,
      id: `${id}-item-${index}`
    }));
  }
  applyListRenderable(renderable, token, previousToken, id, marginBottom = 0) {
    if (!(renderable instanceof BoxRenderable)) return false;
    renderable.marginBottom = marginBottom;
    const inputs = this.getListItemInputs(token, id);
    const previousItems = previousToken?.items ?? [];
    const rows = renderable.getChildren();
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      const existing = rows[index];
      if (existing instanceof BoxRenderable && this.applyListItemRenderable(existing, input, previousItems[index])) {
        continue;
      }
      existing?.destroyRecursively();
      renderable.add(this.createListItemRenderable(input), index);
    }
    for (let index = rows.length - 1; index >= inputs.length; index -= 1) {
      rows[index]?.destroyRecursively();
    }
    return true;
  }
  createListItemRenderable(input) {
    const row = new BoxRenderable(this.ctx, {
      id: input.id,
      width: "100%",
      flexDirection: "row",
      flexShrink: 0,
      marginBottom: /\n[ \t]*\n$/.test(input.item.raw) ? 1 : 0
    });
    row.add(
      new TextRenderable(this.ctx, {
        id: `${input.id}-marker`,
        content: new StyledText([this.createChunk(input.marker.padStart(input.markerWidth) + " ", "markup.list")]),
        width: input.markerWidth + 1,
        flexShrink: 0
      })
    );
    const content = new BoxRenderable(this.ctx, {
      id: `${input.id}-content`,
      flexDirection: "column",
      flexGrow: 1,
      flexShrink: 1
    });
    row.add(content);
    let pendingMarginTop = 0;
    for (let index = 0; index < input.item.tokens.length; index += 1) {
      const child = input.item.tokens[index];
      if (!child) continue;
      if (child.type === "checkbox") continue;
      if (child.type === "space") {
        pendingMarginTop = Math.max(pendingMarginTop, 1);
        continue;
      }
      const renderable = this.createListChildRenderable(child, `${input.id}-child-${index}`);
      if (!renderable) continue;
      renderable.marginTop = child.type === "list" ? 0 : pendingMarginTop;
      pendingMarginTop = 0;
      content.add(renderable);
    }
    return row;
  }
  applyListItemRenderable(row, input, previousItem) {
    this.applyListItemMarker(row, input);
    const content = row.getChildren()[1];
    if (!(content instanceof BoxRenderable)) return false;
    if (previousItem && previousItem.raw === input.item.raw) {
      return true;
    }
    return this.applyListItemChildren(content, input.item, previousItem, input.id);
  }
  applyListItemChildren(content, item, previousItem, id) {
    const previousTokens = previousItem ? this.getRenderableListItemTokens(previousItem) : [];
    const children = content.getChildren();
    let childIndex = 0;
    let pendingMarginTop = 0;
    for (let tokenIndex = 0; tokenIndex < item.tokens.length; tokenIndex += 1) {
      const token = item.tokens[tokenIndex];
      if (!token) continue;
      if (token.type === "checkbox") continue;
      if (token.type === "space") {
        pendingMarginTop = Math.max(pendingMarginTop, 1);
        continue;
      }
      const existing = children[childIndex];
      const childId = `${id}-child-${tokenIndex}`;
      const marginTop = token.type === "list" ? 0 : pendingMarginTop;
      pendingMarginTop = 0;
      if (!existing) {
        const renderable = this.createListChildRenderable(token, childId);
        if (!renderable) return false;
        renderable.marginTop = marginTop;
        content.add(renderable, childIndex);
        childIndex += 1;
        continue;
      }
      if (!this.applyListChildRenderable(existing, token, previousTokens[childIndex], childId)) {
        return false;
      }
      existing.marginTop = marginTop;
      childIndex += 1;
    }
    this.destroyListItemChildrenAfter(content, childIndex);
    return true;
  }
  getRenderableListItemTokens(item) {
    const tokens = [];
    for (const token of item.tokens) {
      if (token.type === "checkbox" || token.type === "space") continue;
      tokens.push(token);
    }
    return tokens;
  }
  applyListChildRenderable(renderable, token, previousToken, id) {
    if ((token.type === "text" || token.type === "paragraph") && renderable instanceof CodeRenderable) {
      this.applyMarkdownCodeRenderable(renderable, this.normalizeScrollbackMarkdownBlockRaw(token.raw), 0);
      return true;
    }
    if (token.type === "list" && renderable instanceof BoxRenderable) {
      return this.applyListRenderable(renderable, token, previousToken, id);
    }
    if (token.type === "code" && renderable instanceof CodeRenderable) {
      this.applyCodeBlockRenderable(renderable, token, 0);
      return true;
    }
    return previousToken?.raw === token.raw;
  }
  destroyListItemChildrenAfter(content, index) {
    const children = content.getChildren();
    for (let i = children.length - 1; i >= index; i -= 1) {
      children[i]?.destroyRecursively();
    }
  }
  applyListItemMarker(row, input) {
    const marker = row.getChildren()[0];
    if (!(marker instanceof TextRenderable)) return;
    const marginBottom = /\n[ \t]*\n$/.test(input.item.raw) ? 1 : 0;
    const markerWidth = input.markerWidth + 1;
    const markerText = input.marker.padStart(input.markerWidth) + " ";
    if (row.marginBottom !== marginBottom) row.marginBottom = marginBottom;
    if (marker.width !== markerWidth) marker.width = markerWidth;
    if (marker.chunks[0]?.text !== markerText) {
      marker.content = new StyledText([this.createChunk(markerText, "markup.list")]);
    }
  }
  createListChildRenderable(token, id) {
    if (token.type === "text" || token.type === "paragraph") {
      return this.createMarkdownTextBlock(token, this.normalizeScrollbackMarkdownBlockRaw(token.raw), id);
    }
    if (token.type === "list") return this.createListRenderable(token, id);
    if (token.type === "code") return this.createCodeRenderable(token, id);
    if (token.type === "blockquote") return this.createBlockquoteRenderable(token, id);
    if (token.type === "hr") return this.createHorizontalRuleRenderable(id);
    if (token.type === "table") return this.createTableBlock(token, id).renderable;
    return token.raw ? this.createMarkdownTextBlock(token, token.raw, id) : null;
  }
  createHorizontalRuleRenderable(id, marginBottom = 0) {
    return new BoxRenderable(this.ctx, {
      id,
      width: "100%",
      height: 1,
      border: ["top"],
      borderColor: this.getStyle("conceal")?.fg ?? this._fg ?? "#888888",
      flexShrink: 0,
      marginBottom
    });
  }
  createCodeRenderable(token, id, marginBottom = 0) {
    return new CodeRenderable(this.ctx, {
      id,
      content: token.text,
      filetype: infoStringToFiletype(token.lang ?? ""),
      syntaxStyle: this._syntaxStyle,
      fg: this._fg,
      bg: this._bg,
      conceal: this._concealCode,
      drawUnstyledText: !this._streaming,
      streaming: this._streaming,
      treeSitterClient: this._treeSitterClient,
      width: "100%",
      marginBottom
    });
  }
  applyMarkdownCodeRenderable(renderable, content, marginBottom, baseHighlight, initialStyledText) {
    renderable.initialStyledText = initialStyledText;
    renderable.filetype = "markdown";
    renderable.syntaxStyle = this._syntaxStyle;
    renderable.fg = this._fg;
    renderable.bg = this._bg;
    renderable.conceal = this._conceal;
    renderable.drawUnstyledText = initialStyledText !== void 0;
    renderable.streaming = true;
    renderable.baseHighlight = baseHighlight;
    renderable.content = content;
    renderable.marginBottom = marginBottom;
  }
  applyBlockquoteRenderable(renderable, token, marginBottom) {
    if (!(renderable instanceof BoxRenderable)) return;
    renderable.borderColor = this.getBlockquoteBorderColor();
    renderable.marginBottom = marginBottom;
    const child = renderable.getChildren()[0];
    if (child instanceof CodeRenderable) {
      this.applyMarkdownCodeRenderable(child, this.getBlockquoteContent(token), 0, "markup.quote");
      return;
    }
    for (const existing of renderable.getChildren()) {
      existing.destroyRecursively();
    }
    renderable.add(
      this.createMarkdownCodeRenderable(
        this.getBlockquoteContent(token),
        `${renderable.id}-content`,
        0,
        this._linkifyMarkdownChunks,
        "markup.quote"
      )
    );
  }
  applyCodeBlockRenderable(renderable, token, marginBottom) {
    if (!(renderable instanceof CodeRenderable)) return;
    renderable.filetype = infoStringToFiletype(token.lang ?? "");
    renderable.syntaxStyle = this._syntaxStyle;
    renderable.fg = this._fg;
    renderable.bg = this._bg;
    renderable.conceal = this._concealCode;
    renderable.drawUnstyledText = !this._streaming;
    renderable.streaming = this._streaming;
    renderable.content = token.text;
    renderable.marginBottom = marginBottom;
  }
  shouldRenderSeparately(token) {
    return token.type === "code" || token.type === "table" || token.type === "blockquote" || token.type === "hr";
  }
  getInterBlockMargin(token, nextToken) {
    if (!nextToken) return 0;
    if (this.shouldRenderSeparately(token)) return 1;
    if (!this.shouldRenderSeparately(nextToken)) return 0;
    return endsWithMarkdownBlockNewline(token.raw) ? 0 : 1;
  }
  applyInterBlockMargin(state, token, nextToken) {
    if (state.tracksInterBlockMargin === false) return;
    state.renderable.marginBottom = this.getInterBlockMargin(token, nextToken);
  }
  createMarkdownBlockToken(raw) {
    return {
      type: "paragraph",
      raw,
      text: raw,
      tokens: []
    };
  }
  normalizeMarkdownBlockRaw(raw) {
    return collapseTrailingMarkdownBlockBreaks(raw);
  }
  normalizeScrollbackMarkdownBlockRaw(raw) {
    return stripTrailingMarkdownBlockNewlines(raw);
  }
  isCodeBlockOnlyRenderer() {
    return this._renderNode?.codeBlockOnly === true;
  }
  buildRenderableTokens(tokens) {
    if (this._renderNode && !this.isCodeBlockOnlyRenderer()) {
      return tokens.filter((token) => token.type !== "space");
    }
    const renderTokens = [];
    let markdownRaw = "";
    const flushMarkdownRaw = () => {
      if (markdownRaw.length === 0) return;
      const normalizedRaw = this.normalizeMarkdownBlockRaw(markdownRaw);
      if (normalizedRaw.length > 0) {
        renderTokens.push(this.createMarkdownBlockToken(normalizedRaw));
      }
      markdownRaw = "";
    };
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.type === "space") {
        if (markdownRaw.length === 0) {
          continue;
        }
        let nextIndex = i + 1;
        while (nextIndex < tokens.length && tokens[nextIndex].type === "space") {
          nextIndex += 1;
        }
        const nextToken = tokens[nextIndex];
        if (nextToken && !this.shouldRenderSeparately(nextToken)) {
          markdownRaw += token.raw;
        }
        continue;
      }
      if (this.shouldRenderSeparately(token)) {
        flushMarkdownRaw();
        renderTokens.push(token);
        continue;
      }
      markdownRaw += token.raw;
    }
    flushMarkdownRaw();
    return renderTokens;
  }
  buildTopLevelRenderBlocks(tokens) {
    const blocks = [];
    let gapBefore = "";
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.type === "space") {
        gapBefore += token.raw;
        continue;
      }
      const prev = blocks[blocks.length - 1];
      const marginTop = prev && this.shouldAddTopLevelMargin(prev.token, token, gapBefore) ? 1 : 0;
      blocks.push({
        token,
        sourceTokenEnd: i + 1,
        marginTop
      });
      gapBefore = "";
    }
    return blocks;
  }
  shouldAddTopLevelMargin(prev, current, gapBefore) {
    if (this.isSeparatedTopLevelBlock(prev) || this.isSeparatedTopLevelBlock(current)) return true;
    if (prev.type !== "paragraph" || current.type !== "paragraph") return false;
    return endsWithMarkdownBlockBreak(prev.raw + gapBefore);
  }
  isSeparatedTopLevelBlock(token) {
    return token.type === "heading" || token.type === "list" || this.shouldRenderSeparately(token);
  }
  getTableRowsToRender(table) {
    return table.rows;
  }
  hashString(value, seed) {
    let hash = seed >>> 0;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
  hashTableToken(token, seed, depth = 0) {
    let hash = this.hashString(token.type, seed);
    if ("raw" in token && typeof token.raw === "string") {
      return this.hashString(token.raw, hash);
    }
    if ("text" in token && typeof token.text === "string") {
      hash = this.hashString(token.text, hash);
    }
    if (depth < 2 && "tokens" in token && Array.isArray(token.tokens)) {
      for (const child of token.tokens) {
        hash = this.hashTableToken(child, hash, depth + 1);
      }
    }
    return hash >>> 0;
  }
  getTableCellKey(cell, isHeader) {
    const seed = isHeader ? 2902232141 : 1371922141;
    if (!cell) {
      return seed;
    }
    if (typeof cell.text === "string") {
      return this.hashString(cell.text, seed);
    }
    if (Array.isArray(cell.tokens) && cell.tokens.length > 0) {
      let hash = seed ^ cell.tokens.length;
      for (const token of cell.tokens) {
        hash = this.hashTableToken(token, hash);
      }
      return hash >>> 0;
    }
    return (seed ^ 2654435769) >>> 0;
  }
  createTableDataCellChunks(cell) {
    const chunks = [];
    if (cell) {
      this.renderInlineContent(cell.tokens, chunks);
    }
    return chunks.length > 0 ? chunks : [this.createDefaultChunk(" ")];
  }
  createTableHeaderCellChunks(cell) {
    const chunks = [];
    this.renderInlineContent(cell.tokens, chunks);
    const baseChunks = chunks.length > 0 ? chunks : [this.createDefaultChunk(" ")];
    const headingStyle = this.getStyle("markup.heading") || this.getStyle("default");
    if (!headingStyle) {
      return baseChunks;
    }
    const headingAttributes = createTextAttributes({
      bold: headingStyle.bold,
      italic: headingStyle.italic,
      underline: headingStyle.underline,
      dim: headingStyle.dim
    });
    return baseChunks.map((chunk) => ({
      ...chunk,
      fg: headingStyle.fg ?? chunk.fg,
      bg: headingStyle.bg ?? chunk.bg,
      attributes: headingAttributes
    }));
  }
  buildTableContentCache(table, previous, forceRegenerate = false) {
    const colCount = table.header.length;
    const rowsToRender = this.getTableRowsToRender(table);
    if (colCount === 0 || rowsToRender.length === 0) {
      return { cache: null, changed: previous !== void 0 };
    }
    const content = [];
    const cellKeys = [];
    const totalRows = rowsToRender.length + 1;
    let changed = forceRegenerate || !previous;
    for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
      const rowContent = [];
      const rowKeys = new Uint32Array(colCount);
      for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
        const isHeader = rowIndex === 0;
        const cell = isHeader ? table.header[colIndex] : rowsToRender[rowIndex - 1]?.[colIndex];
        const cellKey = this.getTableCellKey(cell, isHeader);
        rowKeys[colIndex] = cellKey;
        const previousCellKey = previous?.cellKeys[rowIndex]?.[colIndex];
        const previousCellContent = previous?.content[rowIndex]?.[colIndex];
        if (!forceRegenerate && previousCellKey === cellKey && Array.isArray(previousCellContent)) {
          rowContent.push(previousCellContent);
          continue;
        }
        changed = true;
        rowContent.push(
          isHeader ? this.createTableHeaderCellChunks(table.header[colIndex]) : this.createTableDataCellChunks(cell)
        );
      }
      content.push(rowContent);
      cellKeys.push(rowKeys);
    }
    if (previous && !changed) {
      if (previous.content.length !== content.length) {
        changed = true;
      } else {
        for (let rowIndex = 0; rowIndex < content.length; rowIndex += 1) {
          if ((previous.content[rowIndex]?.length ?? 0) !== content[rowIndex].length) {
            changed = true;
            break;
          }
        }
      }
    }
    return {
      cache: {
        content,
        cellKeys
      },
      changed
    };
  }
  resolveTableStyle(options = this._tableOptions) {
    if (options?.style === "columns") {
      return "columns";
    }
    if (options?.style === "grid") {
      return "grid";
    }
    return this._internalBlockMode === "top-level" ? "columns" : "grid";
  }
  usesBorderlessColumnSpacing(options = this._tableOptions) {
    const style = this.resolveTableStyle(options);
    const borders = options?.borders ?? style === "grid";
    return style === "columns" && !borders;
  }
  resolveTableRenderableOptions() {
    const style = this.resolveTableStyle();
    const borders = this._tableOptions?.borders ?? style === "grid";
    return {
      columnWidthMode: this._tableOptions?.widthMode ?? (style === "columns" ? "content" : "full"),
      columnFitter: this._tableOptions?.columnFitter ?? "proportional",
      wrapMode: this._tableOptions?.wrapMode ?? "word",
      cellPadding: this._tableOptions?.cellPadding ?? 0,
      cellPaddingX: this._tableOptions?.cellPaddingX ?? this._tableOptions?.cellPadding ?? 0,
      cellPaddingY: this._tableOptions?.cellPaddingY ?? this._tableOptions?.cellPadding ?? 0,
      columnGap: this.usesBorderlessColumnSpacing() ? 2 : 0,
      border: borders,
      outerBorder: this._tableOptions?.outerBorder ?? borders,
      showBorders: borders,
      borderStyle: this._tableOptions?.borderStyle ?? "single",
      borderColor: this._tableOptions?.borderColor ?? this.getStyle("conceal")?.fg ?? "#888888",
      selectable: this._tableOptions?.selectable ?? true
    };
  }
  applyTableRenderableOptions(tableRenderable, options) {
    tableRenderable.columnWidthMode = options.columnWidthMode;
    tableRenderable.columnFitter = options.columnFitter;
    tableRenderable.wrapMode = options.wrapMode;
    tableRenderable.cellPaddingX = options.cellPaddingX;
    tableRenderable.cellPaddingY = options.cellPaddingY;
    tableRenderable.columnGap = options.columnGap;
    tableRenderable.border = options.border;
    tableRenderable.outerBorder = options.outerBorder;
    tableRenderable.showBorders = options.showBorders;
    tableRenderable.borderStyle = options.borderStyle;
    tableRenderable.borderColor = options.borderColor;
    tableRenderable.selectable = options.selectable;
  }
  applyTableOptionsToBlocks() {
    const options = this.resolveTableRenderableOptions();
    let updated = false;
    const visit = (renderable) => {
      if (renderable instanceof TextTableRenderable) {
        this.applyTableRenderableOptions(renderable, options);
        updated = true;
        return;
      }
      for (const child of renderable.getChildren()) visit(child);
    };
    for (const state of this._blockStates) visit(state.renderable);
    if (updated) {
      this.requestRender();
    }
  }
  createTextTableRenderable(content, id, marginBottom = 0) {
    const options = this.resolveTableRenderableOptions();
    return new TextTableRenderable(this.ctx, {
      id,
      content,
      width: "100%",
      marginBottom,
      columnWidthMode: options.columnWidthMode,
      columnFitter: options.columnFitter,
      wrapMode: options.wrapMode,
      cellPadding: options.cellPadding,
      cellPaddingX: options.cellPaddingX,
      cellPaddingY: options.cellPaddingY,
      columnGap: options.columnGap,
      border: options.border,
      outerBorder: options.outerBorder,
      showBorders: options.showBorders,
      borderStyle: options.borderStyle,
      borderColor: options.borderColor,
      selectable: options.selectable
    });
  }
  createTableBlock(table, id, marginBottom = 0, previousCache, forceRegenerate = false) {
    const { cache } = this.buildTableContentCache(table, previousCache, forceRegenerate);
    if (!cache) {
      return {
        renderable: this.createMarkdownCodeRenderable(table.raw, id, marginBottom)
      };
    }
    return {
      renderable: this.createTextTableRenderable(cache.content, id, marginBottom),
      tableContentCache: cache
    };
  }
  getStableBlockCount(blocks, stableTokenCount) {
    if (this._internalBlockMode !== "top-level") {
      return 0;
    }
    let stableBlockCount = 0;
    for (const block of blocks) {
      if (block.sourceTokenEnd <= stableTokenCount) {
        stableBlockCount += 1;
        continue;
      }
      break;
    }
    return stableBlockCount;
  }
  syncTopLevelBlockState(state, block, tableContentCache = state.tableContentCache) {
    state.token = block.token;
    state.tokenRaw = block.token.raw;
    state.marginTop = block.marginTop;
    state.tableContentCache = tableContentCache;
  }
  getTopLevelBlockRaw(token) {
    if (!token.raw) {
      return void 0;
    }
    return this.shouldRenderSeparately(token) ? token.raw : this.normalizeScrollbackMarkdownBlockRaw(token.raw);
  }
  createTopLevelDefaultRenderable(block, index) {
    const { token, marginTop } = block;
    const id = `${this.id}-block-${index}`;
    if (token.type === "code") {
      const renderable2 = this.createCodeRenderable(token, id);
      renderable2.marginTop = marginTop;
      return { renderable: renderable2, canUpdateInPlace: true };
    }
    if (token.type === "table") {
      const next = this.createTableBlock(token, id);
      next.renderable.marginTop = marginTop;
      return { ...next, canUpdateInPlace: true };
    }
    if (token.type === "blockquote") {
      const renderable2 = this.createBlockquoteRenderable(token, id);
      renderable2.marginTop = marginTop;
      return { renderable: renderable2, canUpdateInPlace: true };
    }
    if (token.type === "list") {
      const renderable2 = this.createListRenderable(token, id);
      renderable2.marginTop = marginTop;
      return { renderable: renderable2, canUpdateInPlace: true };
    }
    if (token.type === "hr") {
      const renderable2 = this.createHorizontalRuleRenderable(id);
      renderable2.marginTop = marginTop;
      return { renderable: renderable2, canUpdateInPlace: true };
    }
    const markdownRaw = this.getTopLevelBlockRaw(token);
    if (!markdownRaw) {
      return { renderable: void 0, canUpdateInPlace: true };
    }
    const renderable = this.createMarkdownTextBlock(token, markdownRaw, id);
    renderable.marginTop = marginTop;
    return { renderable, canUpdateInPlace: true };
  }
  createTopLevelRenderable(block, index) {
    if (!this._renderNode) {
      return this.createTopLevelDefaultRenderable(block, index);
    }
    const custom = this.createTopLevelCustomRenderable(block, index);
    if (!custom.renderable) return this.createTopLevelDefaultRenderable(block, index);
    const marginTop = typeof custom.renderable.marginTop === "number" ? Math.max(custom.renderable.marginTop, block.marginTop) : block.marginTop;
    this.applyMargins(custom.renderable, marginTop, 0);
    return {
      renderable: custom.renderable,
      tableContentCache: custom.tableContentCache,
      canUpdateInPlace: custom.canUpdateInPlace
    };
  }
  createDefaultRenderable(token, index, nextToken) {
    const id = `${this.id}-block-${index}`;
    const marginBottom = this.getInterBlockMargin(token, nextToken);
    if (token.type === "code") {
      return this.createCodeRenderable(token, id, marginBottom);
    }
    if (token.type === "blockquote") {
      return this.createBlockquoteRenderable(token, id, marginBottom);
    }
    if (token.type === "list") {
      return this.createListRenderable(token, id, marginBottom);
    }
    if (token.type === "hr") {
      return this.createHorizontalRuleRenderable(id, marginBottom);
    }
    if (token.type === "table") {
      return this.createTableBlock(token, id, marginBottom).renderable;
    }
    if (token.type === "space") {
      return null;
    }
    if (!token.raw) {
      return null;
    }
    return this.createMarkdownTextBlock(token, token.raw, id, marginBottom);
  }
  createCustomRenderable(token, index, nextToken) {
    const custom = this.renderCustomNode(token, () => {
      return { renderable: this.createDefaultRenderable(token, index, nextToken) };
    });
    if (!custom.renderable) {
      return { tracksInterBlockMargin: true, canUpdateInPlace: true };
    }
    const canUpdateInPlace = custom.renderable === custom.defaultResult?.renderable;
    return {
      renderable: custom.renderable,
      tracksInterBlockMargin: canUpdateInPlace,
      canUpdateInPlace
    };
  }
  createTopLevelCustomRenderable(block, index) {
    const custom = this.renderCustomNode(block.token, () => {
      return this.createTopLevelDefaultRenderable(block, index);
    });
    if (!custom.renderable) {
      return { tracksInterBlockMargin: true, canUpdateInPlace: true };
    }
    const canUpdateInPlace = custom.renderable === custom.defaultResult?.renderable;
    return {
      renderable: custom.renderable,
      tableContentCache: canUpdateInPlace ? custom.defaultResult?.tableContentCache : void 0,
      tracksInterBlockMargin: canUpdateInPlace,
      canUpdateInPlace
    };
  }
  renderCustomNode(token, createDefault) {
    if (!this._renderNode) return {};
    let defaultResult;
    const custom = this._renderNode(token, {
      syntaxStyle: this._syntaxStyle,
      conceal: this._conceal,
      concealCode: this._concealCode,
      treeSitterClient: this._treeSitterClient,
      defaultRender: () => {
        defaultResult = createDefault();
        return defaultResult.renderable ?? null;
      }
    });
    this.destroyUnusedDefaultRenderable(defaultResult?.renderable, custom ?? void 0);
    return custom ? { renderable: custom, defaultResult } : {};
  }
  destroyUnusedDefaultRenderable(renderable, usedRenderable) {
    if (!renderable || renderable === usedRenderable || renderable.parent) return;
    renderable.destroyRecursively();
  }
  updateBlockRenderable(state, token, index, nextToken, forceListRefresh = false, forceTableRegenerate = false) {
    const marginBottom = this.getInterBlockMargin(token, nextToken);
    if (token.type === "code") {
      this.applyCodeBlockRenderable(state.renderable, token, marginBottom);
      return;
    }
    if (token.type === "blockquote") {
      this.applyBlockquoteRenderable(state.renderable, token, marginBottom);
      return;
    }
    if (token.type === "list") {
      if (!this.applyListRenderable(
        state.renderable,
        token,
        forceListRefresh ? void 0 : state.token,
        `${this.id}-block-${index}`,
        marginBottom
      )) {
        state.renderable.destroyRecursively();
        state.renderable = this.createListRenderable(token, `${this.id}-block-${index}`, marginBottom);
        this.add(state.renderable, index);
      }
      return;
    }
    if (token.type === "hr") {
      state.renderable.marginBottom = marginBottom;
      return;
    }
    if (token.type === "table") {
      const tableToken = token;
      const { cache, changed } = this.buildTableContentCache(tableToken, state.tableContentCache, forceTableRegenerate);
      if (!cache) {
        if (state.renderable instanceof CodeRenderable) {
          this.applyMarkdownCodeRenderable(state.renderable, tableToken.raw, marginBottom);
          state.tableContentCache = void 0;
          return;
        }
        state.renderable.destroyRecursively();
        const fallbackRenderable = this.createMarkdownCodeRenderable(
          tableToken.raw,
          `${this.id}-block-${index}`,
          marginBottom
        );
        this.add(fallbackRenderable, index);
        state.renderable = fallbackRenderable;
        state.tableContentCache = void 0;
        return;
      }
      if (state.renderable instanceof TextTableRenderable) {
        if (changed) {
          state.renderable.content = cache.content;
        }
        this.applyTableRenderableOptions(state.renderable, this.resolveTableRenderableOptions());
        state.renderable.marginBottom = marginBottom;
        state.tableContentCache = cache;
        return;
      }
      state.renderable.destroyRecursively();
      const tableRenderable = this.createTextTableRenderable(cache.content, `${this.id}-block-${index}`, marginBottom);
      this.add(tableRenderable, index);
      state.renderable = tableRenderable;
      state.tableContentCache = cache;
      return;
    }
    if (state.renderable instanceof CodeRenderable) {
      this.applyMarkdownCodeRenderable(
        state.renderable,
        this.getTopLevelBlockRaw(token) ?? token.raw,
        marginBottom,
        void 0,
        this.createInitialStyledText(token)
      );
      return;
    }
    state.renderable.destroyRecursively();
    const markdownRenderable = this.createMarkdownTextBlock(
      token,
      this.getTopLevelBlockRaw(token) ?? token.raw,
      `${this.id}-block-${index}`,
      marginBottom
    );
    this.add(markdownRenderable, index);
    state.renderable = markdownRenderable;
  }
  updateTopLevelBlocks(tokens, forceTableRefresh) {
    const blocks = this.buildTopLevelRenderBlocks(tokens);
    this._stableBlockCount = this.getStableBlockCount(blocks, this._parseState?.stableTokenCount ?? 0);
    let blockIndex = 0;
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      const existing = this._blockStates[blockIndex];
      if (existing && existing.token === block.token && !forceTableRefresh) {
        if (existing.marginTop !== block.marginTop) {
          this.applyMargins(existing.renderable, block.marginTop, 0);
        }
        this.syncTopLevelBlockState(existing, block);
        blockIndex++;
        continue;
      }
      if (existing && existing.tokenRaw === block.token.raw && existing.token.type === block.token.type && !forceTableRefresh) {
        if (existing.marginTop !== block.marginTop) {
          this.applyMargins(existing.renderable, block.marginTop, 0);
        }
        this.syncTopLevelBlockState(existing, block);
        blockIndex++;
        continue;
      }
      if (existing && !forceTableRefresh && existing.canUpdateInPlace && existing.token.type === block.token.type && this.canUpdateBlockRenderable(existing.renderable, block.token)) {
        if (this._renderNode) {
          const custom = this.createTopLevelCustomRenderable(block, blockIndex);
          if (custom.renderable && !custom.canUpdateInPlace) {
            const marginTop = typeof custom.renderable.marginTop === "number" ? Math.max(custom.renderable.marginTop, block.marginTop) : block.marginTop;
            this.applyMargins(custom.renderable, marginTop, 0);
            if (custom.renderable !== existing.renderable) {
              existing.renderable.destroyRecursively();
              this.add(custom.renderable, blockIndex);
            }
            this._blockStates[blockIndex] = {
              token: block.token,
              tokenRaw: block.token.raw,
              marginTop: block.marginTop,
              renderable: custom.renderable,
              tableContentCache: custom.tableContentCache,
              canUpdateInPlace: custom.canUpdateInPlace
            };
            blockIndex++;
            continue;
          }
          this.destroyUnusedDefaultRenderable(custom.renderable);
        }
        this.updateBlockRenderable(existing, block.token, blockIndex, blocks[i + 1]?.token);
        existing.renderable.marginBottom = 0;
        if (existing.marginTop !== block.marginTop) {
          this.applyMargins(existing.renderable, block.marginTop, 0);
        }
        this.syncTopLevelBlockState(existing, block);
        blockIndex++;
        continue;
      }
      if (existing) {
        existing.renderable.destroyRecursively();
      }
      const next = this.createTopLevelRenderable(block, blockIndex);
      if (next.renderable) {
        this.add(next.renderable, blockIndex);
        this._blockStates[blockIndex] = {
          token: block.token,
          tokenRaw: block.token.raw,
          marginTop: block.marginTop,
          renderable: next.renderable,
          tableContentCache: next.tableContentCache,
          canUpdateInPlace: next.canUpdateInPlace
        };
      }
      blockIndex++;
    }
    while (this._blockStates.length > blockIndex) {
      const removed = this._blockStates.pop();
      removed.renderable.destroyRecursively();
    }
  }
  canUpdateBlockRenderable(renderable, token) {
    if (token.type === "code") return renderable instanceof CodeRenderable;
    if (token.type === "table") return renderable instanceof TextTableRenderable;
    if (token.type === "blockquote") return renderable instanceof BoxRenderable;
    if (token.type === "list") return renderable instanceof BoxRenderable;
    if (token.type === "hr") return renderable instanceof BoxRenderable;
    return renderable instanceof CodeRenderable;
  }
  updateBlocks(forceTableRefresh = false) {
    if (this.isDestroyed) return;
    if (!this._content) {
      this.clearBlockStates();
      this._parseState = null;
      this._stableBlockCount = 0;
      return;
    }
    if (forceTableRefresh && this._renderNode && this._internalBlockMode !== "top-level") {
      this.clearBlockStates();
      forceTableRefresh = false;
    }
    const trailingUnstable = this._streaming ? 2 : 0;
    this._parseState = parseMarkdownIncremental(this._content, this._parseState, trailingUnstable);
    const tokens = this._parseState.tokens;
    if (tokens.length === 0 && this._content.length > 0) {
      this.clearBlockStates();
      this._stableBlockCount = 0;
      const fallback = this.createMarkdownCodeRenderable(this._content, `${this.id}-fallback`);
      this.add(fallback);
      this._blockStates = [
        {
          token: { type: "text", raw: this._content, text: this._content },
          tokenRaw: this._content,
          marginTop: 0,
          renderable: fallback,
          tracksInterBlockMargin: true,
          canUpdateInPlace: true
        }
      ];
      return;
    }
    if (this._internalBlockMode === "top-level") {
      this.updateTopLevelBlocks(tokens, forceTableRefresh);
      return;
    }
    this._stableBlockCount = 0;
    const blockTokens = this.buildRenderableTokens(tokens);
    let blockIndex = 0;
    for (let i = 0; i < blockTokens.length; i++) {
      const token = blockTokens[i];
      const nextToken = blockTokens[i + 1];
      const existing = this._blockStates[blockIndex];
      const shouldForceRefresh = forceTableRefresh;
      if (existing && existing.token === token) {
        if (shouldForceRefresh) {
          this.updateBlockRenderable(existing, token, blockIndex, nextToken);
          existing.tokenRaw = token.raw;
        } else {
          this.applyInterBlockMargin(existing, token, nextToken);
        }
        blockIndex++;
        continue;
      }
      if (existing && existing.tokenRaw === token.raw && existing.token.type === token.type) {
        existing.token = token;
        if (shouldForceRefresh) {
          this.updateBlockRenderable(existing, token, blockIndex, nextToken);
          existing.tokenRaw = token.raw;
        } else {
          this.applyInterBlockMargin(existing, token, nextToken);
        }
        blockIndex++;
        continue;
      }
      if (existing && existing.canUpdateInPlace && existing.token.type === token.type) {
        const custom2 = this.createCustomRenderable(token, blockIndex, nextToken);
        if (custom2.renderable && !custom2.canUpdateInPlace) {
          if (custom2.renderable !== existing.renderable) {
            existing.renderable.destroyRecursively();
            this.add(custom2.renderable, blockIndex);
          }
          this._blockStates[blockIndex] = {
            token,
            tokenRaw: token.raw,
            renderable: custom2.renderable,
            tracksInterBlockMargin: custom2.tracksInterBlockMargin,
            canUpdateInPlace: custom2.canUpdateInPlace
          };
          blockIndex++;
          continue;
        }
        this.destroyUnusedDefaultRenderable(custom2.renderable);
        this.updateBlockRenderable(existing, token, blockIndex, nextToken);
        existing.token = token;
        existing.tokenRaw = token.raw;
        existing.tracksInterBlockMargin = true;
        blockIndex++;
        continue;
      }
      if (existing) {
        existing.renderable.destroyRecursively();
      }
      let renderable;
      let tableContentCache;
      let tracksInterBlockMargin = true;
      let canUpdateInPlace = true;
      const custom = this.createCustomRenderable(token, blockIndex, nextToken);
      if (custom.renderable) {
        renderable = custom.renderable;
        tracksInterBlockMargin = custom.tracksInterBlockMargin;
        canUpdateInPlace = custom.canUpdateInPlace;
      }
      if (!renderable) {
        if (token.type === "table") {
          const tableBlock = this.createTableBlock(
            token,
            `${this.id}-block-${blockIndex}`,
            this.getInterBlockMargin(token, nextToken)
          );
          renderable = tableBlock.renderable;
          tableContentCache = tableBlock.tableContentCache;
        } else {
          renderable = this.createDefaultRenderable(token, blockIndex, nextToken) ?? void 0;
        }
      }
      if (token.type === "table" && !tableContentCache && renderable instanceof TextTableRenderable) {
        const { cache } = this.buildTableContentCache(token);
        tableContentCache = cache ?? void 0;
      }
      if (renderable) {
        this.add(renderable, blockIndex);
        this._blockStates[blockIndex] = {
          token,
          tokenRaw: token.raw,
          renderable,
          tableContentCache,
          tracksInterBlockMargin,
          canUpdateInPlace
        };
      }
      blockIndex++;
    }
    while (this._blockStates.length > blockIndex) {
      const removed = this._blockStates.pop();
      removed.renderable.destroyRecursively();
    }
  }
  clearBlockStates() {
    for (const state of this._blockStates) {
      state.renderable.destroyRecursively();
    }
    this._blockStates = [];
    this._stableBlockCount = 0;
  }
  /**
   * Re-render existing blocks without rebuilding the parse state or block structure.
   * Used when only style/conceal changes - much faster than full rebuild.
   */
  rerenderBlocks() {
    if (this._renderNode || this._internalBlockMode === "top-level") {
      this.updateBlocks(true);
      return;
    }
    for (let i = 0; i < this._blockStates.length; i++) {
      const state = this._blockStates[i];
      this.updateBlockRenderable(state, state.token, i, this._blockStates[i + 1]?.token, true, true);
    }
  }
  clearCache() {
    this._parseState = null;
    this.clearBlockStates();
    this.updateBlocks();
    this.requestRender();
  }
  refreshStyles() {
    this._styleDirty = false;
    this.rerenderBlocks();
    this.requestRender();
  }
  renderSelf(buffer, deltaTime) {
    if (this._styleDirty) {
      this._styleDirty = false;
      this.rerenderBlocks();
    }
    super.renderSelf(buffer, deltaTime);
  }
};

// src/renderables/Slider.ts
var defaultThumbBackgroundColor = RGBA.fromHex("#9a9ea3");
var defaultTrackBackgroundColor = RGBA.fromHex("#252527");
var SliderRenderable = class extends Renderable {
  orientation;
  _value;
  _min;
  _max;
  _viewPortSize;
  _backgroundColor;
  _foregroundColor;
  _onChange;
  constructor(ctx, options) {
    super(ctx, { flexShrink: 0, ...options });
    this.orientation = options.orientation;
    this._min = options.min ?? 0;
    this._max = options.max ?? 100;
    this._value = options.value ?? this._min;
    const requestedViewPortSize = options.viewPortSize;
    this._viewPortSize = requestedViewPortSize !== void 0 && Number.isFinite(requestedViewPortSize) ? clamp(requestedViewPortSize, 0.01, this._max - this._min) : Math.max(1, (this._max - this._min) * 0.1);
    this._onChange = options.onChange;
    this._backgroundColor = options.backgroundColor ? parseColor(options.backgroundColor) : defaultTrackBackgroundColor;
    this._foregroundColor = options.foregroundColor ? parseColor(options.foregroundColor) : defaultThumbBackgroundColor;
    this.setupMouseHandling();
  }
  get value() {
    return this._value;
  }
  set value(newValue) {
    const clamped = clamp(newValue, this._min, this._max);
    if (clamped !== this._value) {
      this._value = clamped;
      this._onChange?.(clamped);
      this.emit("change", { value: clamped });
      this.requestRender();
    }
  }
  get min() {
    return this._min;
  }
  set min(newMin) {
    if (newMin !== this._min) {
      this._min = newMin;
      if (this._value < newMin) {
        this.value = newMin;
      }
      this.requestRender();
    }
  }
  get max() {
    return this._max;
  }
  set max(newMax) {
    if (newMax !== this._max) {
      this._max = newMax;
      if (this._value > newMax) {
        this.value = newMax;
      }
      this.requestRender();
    }
  }
  set viewPortSize(size) {
    const clampedSize = clamp(size, 0.01, this._max - this._min);
    if (clampedSize !== this._viewPortSize) {
      this._viewPortSize = clampedSize;
      this.requestRender();
    }
  }
  get viewPortSize() {
    return this._viewPortSize;
  }
  get backgroundColor() {
    return this._backgroundColor;
  }
  set backgroundColor(value) {
    this._backgroundColor = parseColor(value);
    this.requestRender();
  }
  get foregroundColor() {
    return this._foregroundColor;
  }
  set foregroundColor(value) {
    this._foregroundColor = parseColor(value);
    this.requestRender();
  }
  calculateDragOffsetVirtual(event) {
    const trackStart = this.orientation === "vertical" ? this.y : this.x;
    const mousePos = (this.orientation === "vertical" ? event.y : event.x) - trackStart;
    const virtualMousePos = clamp(
      mousePos * 2,
      0,
      (this.orientation === "vertical" ? this.height : this.width) * 2
    );
    const virtualThumbStart = this.getVirtualThumbStart();
    const virtualThumbSize = this.getVirtualThumbSize();
    return clamp(virtualMousePos - virtualThumbStart, 0, virtualThumbSize);
  }
  setupMouseHandling() {
    let isDragging = false;
    let dragOffsetVirtual = 0;
    this.onMouseDown = (event) => {
      event.stopPropagation();
      event.preventDefault();
      const thumb = this.getThumbRect();
      const inThumb = event.x >= thumb.x && event.x < thumb.x + thumb.width && event.y >= thumb.y && event.y < thumb.y + thumb.height;
      if (inThumb) {
        isDragging = true;
        dragOffsetVirtual = this.calculateDragOffsetVirtual(event);
      } else {
        this.updateValueFromMouseDirect(event);
        isDragging = true;
        dragOffsetVirtual = this.calculateDragOffsetVirtual(event);
      }
    };
    this.onMouseDrag = (event) => {
      if (!isDragging) return;
      event.stopPropagation();
      this.updateValueFromMouseWithOffset(event, dragOffsetVirtual);
    };
    this.onMouseUp = (event) => {
      if (isDragging) {
        this.updateValueFromMouseWithOffset(event, dragOffsetVirtual);
      }
      isDragging = false;
    };
  }
  updateValueFromMouseDirect(event) {
    const trackStart = this.orientation === "vertical" ? this.y : this.x;
    const trackSize = this.orientation === "vertical" ? this.height : this.width;
    const mousePos = this.orientation === "vertical" ? event.y : event.x;
    const relativeMousePos = mousePos - trackStart;
    const clampedMousePos = clamp(relativeMousePos, 0, trackSize);
    const ratio = trackSize === 0 ? 0 : clampedMousePos / trackSize;
    const range = this._max - this._min;
    const newValue = this._min + ratio * range;
    this.value = newValue;
  }
  updateValueFromMouseWithOffset(event, offsetVirtual) {
    const trackStart = this.orientation === "vertical" ? this.y : this.x;
    const trackSize = this.orientation === "vertical" ? this.height : this.width;
    const mousePos = this.orientation === "vertical" ? event.y : event.x;
    const virtualTrackSize = trackSize * 2;
    const relativeMousePos = mousePos - trackStart;
    const clampedMousePos = clamp(relativeMousePos, 0, trackSize);
    const virtualMousePos = clampedMousePos * 2;
    const virtualThumbSize = this.getVirtualThumbSize();
    const maxThumbStart = Math.max(0, virtualTrackSize - virtualThumbSize);
    let desiredThumbStart = virtualMousePos - offsetVirtual;
    desiredThumbStart = clamp(desiredThumbStart, 0, maxThumbStart);
    const ratio = maxThumbStart === 0 ? 0 : desiredThumbStart / maxThumbStart;
    const range = this._max - this._min;
    const newValue = this._min + ratio * range;
    this.value = newValue;
  }
  getThumbRect() {
    const virtualThumbSize = this.getVirtualThumbSize();
    const virtualThumbStart = this.getVirtualThumbStart();
    const realThumbStart = Math.floor(virtualThumbStart / 2);
    const realThumbSize = Math.ceil((virtualThumbStart + virtualThumbSize) / 2) - realThumbStart;
    if (this.orientation === "vertical") {
      return {
        x: this.x,
        y: this.y + realThumbStart,
        width: this.width,
        height: Math.max(1, realThumbSize)
      };
    } else {
      return {
        x: this.x + realThumbStart,
        y: this.y,
        width: Math.max(1, realThumbSize),
        height: this.height
      };
    }
  }
  renderSelf(buffer) {
    if (this.orientation === "horizontal") {
      this.renderHorizontal(buffer);
    } else {
      this.renderVertical(buffer);
    }
  }
  renderHorizontal(buffer) {
    const virtualThumbSize = this.getVirtualThumbSize();
    const virtualThumbStart = this.getVirtualThumbStart();
    const virtualThumbEnd = virtualThumbStart + virtualThumbSize;
    buffer.fillRect(this.x, this.y, this.width, this.height, this._backgroundColor);
    const realStartCell = Math.floor(virtualThumbStart / 2);
    const realEndCell = Math.ceil(virtualThumbEnd / 2) - 1;
    const startX = Math.max(0, realStartCell);
    const endX = Math.min(this.width - 1, realEndCell);
    for (let realX = startX; realX <= endX; realX++) {
      const virtualCellStart = realX * 2;
      const virtualCellEnd = virtualCellStart + 2;
      const thumbStartInCell = Math.max(virtualThumbStart, virtualCellStart);
      const thumbEndInCell = Math.min(virtualThumbEnd, virtualCellEnd);
      const coverage = thumbEndInCell - thumbStartInCell;
      let char = " ";
      if (coverage >= 2) {
        char = "\u2588";
      } else {
        const isLeftHalf = thumbStartInCell === virtualCellStart;
        if (isLeftHalf) {
          char = "\u258C";
        } else {
          char = "\u2590";
        }
      }
      for (let y = 0; y < this.height; y++) {
        buffer.setCellWithAlphaBlending(this.x + realX, this.y + y, char, this._foregroundColor, this._backgroundColor);
      }
    }
  }
  renderVertical(buffer) {
    const virtualThumbSize = this.getVirtualThumbSize();
    const virtualThumbStart = this.getVirtualThumbStart();
    const virtualThumbEnd = virtualThumbStart + virtualThumbSize;
    buffer.fillRect(this.x, this.y, this.width, this.height, this._backgroundColor);
    const realStartCell = Math.floor(virtualThumbStart / 2);
    const realEndCell = Math.ceil(virtualThumbEnd / 2) - 1;
    const startY = Math.max(0, realStartCell);
    const endY = Math.min(this.height - 1, realEndCell);
    for (let realY = startY; realY <= endY; realY++) {
      const virtualCellStart = realY * 2;
      const virtualCellEnd = virtualCellStart + 2;
      const thumbStartInCell = Math.max(virtualThumbStart, virtualCellStart);
      const thumbEndInCell = Math.min(virtualThumbEnd, virtualCellEnd);
      const coverage = thumbEndInCell - thumbStartInCell;
      let char = " ";
      if (coverage >= 2) {
        char = "\u2588";
      } else if (coverage > 0) {
        const virtualPositionInCell = thumbStartInCell - virtualCellStart;
        if (virtualPositionInCell === 0) {
          char = "\u2580";
        } else {
          char = "\u2584";
        }
      }
      for (let x = 0; x < this.width; x++) {
        buffer.setCellWithAlphaBlending(this.x + x, this.y + realY, char, this._foregroundColor, this._backgroundColor);
      }
    }
  }
  getVirtualThumbSize() {
    const virtualTrackSize = this.orientation === "vertical" ? this.height * 2 : this.width * 2;
    const range = this._max - this._min;
    if (range === 0) return virtualTrackSize;
    const viewportSize = Math.max(1, this._viewPortSize);
    const contentSize = range + viewportSize;
    if (contentSize <= viewportSize) return virtualTrackSize;
    const thumbRatio = viewportSize / contentSize;
    const calculatedSize = Math.floor(virtualTrackSize * thumbRatio);
    return Math.max(1, Math.min(calculatedSize, virtualTrackSize));
  }
  getVirtualThumbStart() {
    const virtualTrackSize = this.orientation === "vertical" ? this.height * 2 : this.width * 2;
    const range = this._max - this._min;
    if (range === 0) return 0;
    const valueRatio = (this._value - this._min) / range;
    const virtualThumbSize = this.getVirtualThumbSize();
    return Math.round(valueRatio * (virtualTrackSize - virtualThumbSize));
  }
};

// src/renderables/ScrollBar.ts
var ScrollBarRenderable = class extends Renderable {
  slider;
  startArrow;
  endArrow;
  orientation;
  _focusable = true;
  _scrollSize = 0;
  _scrollPosition = 0;
  _viewportSize = 0;
  _showArrows = false;
  _manualVisibility = false;
  _onChange;
  // Arrow auto-repeat chains (setTimeout -> setInterval). Held across the
  // handlers so destroy can clear them; a mouseup never arrives after destroy
  // because the renderable number is already deregistered.
  startArrowMouseTimer;
  endArrowMouseTimer;
  scrollStep = null;
  get visible() {
    return super.visible;
  }
  set visible(value) {
    this._manualVisibility = true;
    super.visible = value;
  }
  resetVisibilityControl() {
    this._manualVisibility = false;
    this.recalculateVisibility();
  }
  get scrollSize() {
    return this._scrollSize;
  }
  get scrollPosition() {
    return this._scrollPosition;
  }
  get viewportSize() {
    return this._viewportSize;
  }
  set scrollSize(value) {
    if (value === this.scrollSize) return;
    this._scrollSize = value;
    this.recalculateVisibility();
    this.updateSliderFromScrollState();
    this.scrollPosition = this.scrollPosition;
  }
  set scrollPosition(value) {
    const newPosition = Math.round(clamp(value, 0, Math.max(0, this.scrollSize - this.viewportSize)));
    if (newPosition !== this._scrollPosition) {
      this._scrollPosition = newPosition;
      this.updateSliderFromScrollState();
    }
  }
  set viewportSize(value) {
    if (value === this.viewportSize) return;
    this._viewportSize = value;
    this.slider.viewPortSize = Math.max(1, this._viewportSize);
    this.recalculateVisibility();
    this.updateSliderFromScrollState();
    this.scrollPosition = this.scrollPosition;
  }
  get showArrows() {
    return this._showArrows;
  }
  set showArrows(value) {
    if (value === this._showArrows) return;
    this._showArrows = value;
    this.startArrow.visible = value;
    this.endArrow.visible = value;
  }
  constructor(ctx, { trackOptions, arrowOptions, orientation, showArrows = false, ...options }) {
    super(ctx, {
      flexDirection: orientation === "vertical" ? "column" : "row",
      alignSelf: "stretch",
      alignItems: "stretch",
      ...options
    });
    this._focusable = options.focusable ?? true;
    this._onChange = options.onChange;
    this.orientation = orientation;
    this._showArrows = showArrows;
    const scrollRange = Math.max(0, this._scrollSize - this._viewportSize);
    const defaultStepSize = Math.max(1, this._viewportSize);
    const stepSize = trackOptions?.viewPortSize ?? defaultStepSize;
    this.slider = new SliderRenderable(ctx, {
      orientation,
      min: 0,
      max: scrollRange,
      value: this._scrollPosition,
      viewPortSize: stepSize,
      onChange: (value) => {
        this._scrollPosition = Math.round(value);
        this._onChange?.(this._scrollPosition);
        this.emit("change", { position: this._scrollPosition });
      },
      ...orientation === "vertical" ? {
        width: Math.max(1, Math.min(2, this.width)),
        height: "100%",
        marginLeft: "auto"
      } : {
        width: "100%",
        height: 1,
        marginTop: "auto"
      },
      flexGrow: 1,
      flexShrink: 1,
      ...trackOptions
    });
    this.updateSliderFromScrollState();
    const arrowOpts = arrowOptions ? {
      foregroundColor: arrowOptions.backgroundColor,
      backgroundColor: arrowOptions.backgroundColor,
      attributes: arrowOptions.attributes,
      ...arrowOptions
    } : {};
    this.startArrow = new ArrowRenderable(ctx, {
      alignSelf: "center",
      visible: this.showArrows,
      direction: this.orientation === "vertical" ? "up" : "left",
      height: this.orientation === "vertical" ? 1 : 1,
      ...arrowOpts
    });
    this.endArrow = new ArrowRenderable(ctx, {
      alignSelf: "center",
      visible: this.showArrows,
      direction: this.orientation === "vertical" ? "down" : "right",
      height: this.orientation === "vertical" ? 1 : 1,
      ...arrowOpts
    });
    this.add(this.startArrow);
    this.add(this.slider);
    this.add(this.endArrow);
    this.startArrow.onMouseDown = (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.scrollBy(-0.5, "viewport");
      this.startArrowMouseTimer = setTimeout(() => {
        this.scrollBy(-0.5, "viewport");
        this.startArrowMouseTimer = setInterval(() => {
          this.scrollBy(-0.2, "viewport");
        }, 200);
      }, 500);
    };
    this.startArrow.onMouseUp = (event) => {
      event.stopPropagation();
      clearInterval(this.startArrowMouseTimer);
    };
    this.endArrow.onMouseDown = (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.scrollBy(0.5, "viewport");
      this.endArrowMouseTimer = setTimeout(() => {
        this.scrollBy(0.5, "viewport");
        this.endArrowMouseTimer = setInterval(() => {
          this.scrollBy(0.2, "viewport");
        }, 200);
      }, 500);
    };
    this.endArrow.onMouseUp = (event) => {
      event.stopPropagation();
      clearInterval(this.endArrowMouseTimer);
    };
  }
  destroySelf() {
    clearTimeout(this.startArrowMouseTimer);
    clearInterval(this.startArrowMouseTimer);
    this.startArrowMouseTimer = void 0;
    clearTimeout(this.endArrowMouseTimer);
    clearInterval(this.endArrowMouseTimer);
    this.endArrowMouseTimer = void 0;
  }
  set arrowOptions(options) {
    Object.assign(this.startArrow, options);
    Object.assign(this.endArrow, options);
    this.requestRender();
  }
  set trackOptions(options) {
    Object.assign(this.slider, options);
    this.requestRender();
  }
  updateSliderFromScrollState() {
    const scrollRange = Math.max(0, this._scrollSize - this._viewportSize);
    this.slider.min = 0;
    this.slider.max = scrollRange;
    this.slider.value = Math.min(this._scrollPosition, scrollRange);
  }
  scrollBy(delta, unit = "absolute") {
    const multiplier = unit === "viewport" ? this.viewportSize : unit === "content" ? this.scrollSize : unit === "step" ? this.scrollStep ?? 1 : 1;
    const resolvedDelta = multiplier * delta;
    this.scrollPosition += resolvedDelta;
  }
  recalculateVisibility() {
    if (!this._manualVisibility) {
      const sizeRatio = this.scrollSize <= this.viewportSize ? 1 : this.viewportSize / this.scrollSize;
      super.visible = sizeRatio < 1;
    }
  }
  handleKeyPress(key) {
    if (this.scrollSize <= this.viewportSize) return false;
    switch (key.name) {
      case "left":
      case "h":
        if (this.orientation !== "horizontal") return false;
        this.scrollBy(-1 / 5, "viewport");
        return true;
      case "right":
      case "l":
        if (this.orientation !== "horizontal") return false;
        this.scrollBy(1 / 5, "viewport");
        return true;
      case "up":
      case "k":
        if (this.orientation !== "vertical") return false;
        this.scrollBy(-1 / 5, "viewport");
        return true;
      case "down":
      case "j":
        if (this.orientation !== "vertical") return false;
        this.scrollBy(1 / 5, "viewport");
        return true;
      case "pageup":
        this.scrollBy(-1 / 2, "viewport");
        return true;
      case "pagedown":
        this.scrollBy(1 / 2, "viewport");
        return true;
      case "home":
        this.scrollBy(-1, "content");
        return true;
      case "end":
        this.scrollBy(1, "content");
        return true;
    }
    return false;
  }
};
var ArrowRenderable = class extends Renderable {
  _direction;
  _foregroundColor;
  _backgroundColor;
  _attributes;
  _arrowChars;
  constructor(ctx, options) {
    super(ctx, options);
    this._direction = options.direction;
    this._foregroundColor = options.foregroundColor ? parseColor(options.foregroundColor) : RGBA.fromValues(1, 1, 1, 1);
    this._backgroundColor = options.backgroundColor ? parseColor(options.backgroundColor) : RGBA.fromValues(0, 0, 0, 0);
    this._attributes = options.attributes ?? 0;
    this._arrowChars = {
      up: "\u25B2",
      down: "\u25BC",
      left: "\u25C0",
      right: "\u25B6",
      ...options.arrowChars
    };
    if (!options.width) {
      this.width = stringWidth(this.getArrowChar());
    }
  }
  get direction() {
    return this._direction;
  }
  set direction(value) {
    if (this._direction !== value) {
      this._direction = value;
      this.requestRender();
    }
  }
  get foregroundColor() {
    return this._foregroundColor;
  }
  set foregroundColor(value) {
    if (this._foregroundColor !== value) {
      this._foregroundColor = parseColor(value);
      this.requestRender();
    }
  }
  get backgroundColor() {
    return this._backgroundColor;
  }
  set backgroundColor(value) {
    if (this._backgroundColor !== value) {
      this._backgroundColor = parseColor(value);
      this.requestRender();
    }
  }
  get attributes() {
    return this._attributes;
  }
  set attributes(value) {
    if (this._attributes !== value) {
      this._attributes = value;
      this.requestRender();
    }
  }
  set arrowChars(value) {
    this._arrowChars = {
      ...this._arrowChars,
      ...value
    };
    this.requestRender();
  }
  renderSelf(buffer) {
    const char = this.getArrowChar();
    buffer.drawText(char, this.x, this.y, this._foregroundColor, this._backgroundColor, this._attributes);
  }
  getArrowChar() {
    switch (this._direction) {
      case "up":
        return this._arrowChars.up;
      case "down":
        return this._arrowChars.down;
      case "left":
        return this._arrowChars.left;
      case "right":
        return this._arrowChars.right;
      default:
        return "?";
    }
  }
};

// src/renderables/ScrollBox.ts
var ContentRenderable = class extends BoxRenderable {
  viewport;
  _viewportCulling;
  constructor(ctx, viewport, viewportCulling, options) {
    super(ctx, options);
    this.viewport = viewport;
    this._viewportCulling = viewportCulling;
  }
  get viewportCulling() {
    return this._viewportCulling;
  }
  set viewportCulling(value) {
    this._viewportCulling = value;
  }
  _hasVisibleChildFilter() {
    return this._viewportCulling;
  }
  _getVisibleChildren() {
    if (this._viewportCulling) {
      return getObjectsInViewport(
        {
          x: this.viewport.screenX,
          y: this.viewport.screenY,
          width: this.viewport.width,
          height: this.viewport.height
        },
        this.getChildrenSortedByPrimaryAxis(),
        this.primaryAxis,
        0
      ).map((child) => child.num);
    }
    return super._getVisibleChildren();
  }
};
var SCROLLBOX_PADDING_KEYS = [
  "padding",
  "paddingX",
  "paddingY",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft"
];
function pickScrollBoxPadding(options) {
  if (!options) return {};
  const picked = {};
  for (const key of SCROLLBOX_PADDING_KEYS) {
    const value = options[key];
    if (value !== void 0) {
      picked[key] = value;
    }
  }
  return picked;
}
function stripScrollBoxPadding(options) {
  const sanitized = { ...options };
  for (const key of SCROLLBOX_PADDING_KEYS) {
    delete sanitized[key];
  }
  return sanitized;
}
var ScrollBoxRenderable = class _ScrollBoxRenderable extends BoxRenderable {
  static idCounter = 0;
  internalId = 0;
  wrapper;
  viewport;
  content;
  horizontalScrollBar;
  verticalScrollBar;
  _focusable = true;
  selectionListener;
  autoScrollMouseX = 0;
  autoScrollMouseY = 0;
  autoScrollThresholdVertical = 3;
  autoScrollThresholdHorizontal = 3;
  autoScrollSpeedSlow = 6;
  autoScrollSpeedMedium = 36;
  autoScrollSpeedFast = 72;
  isAutoScrolling = false;
  cachedAutoScrollSpeed = 3;
  autoScrollAccumulatorX = 0;
  autoScrollAccumulatorY = 0;
  scrollAccumulatorX = 0;
  scrollAccumulatorY = 0;
  _stickyScroll;
  _stickyScrollTop = false;
  _stickyScrollBottom = false;
  _stickyScrollLeft = false;
  _stickyScrollRight = false;
  _stickyStart;
  _hasManualScroll = false;
  _isApplyingStickyScroll = false;
  scrollAccel;
  get stickyScroll() {
    return this._stickyScroll;
  }
  set stickyScroll(value) {
    this._stickyScroll = value;
    this.updateStickyState();
  }
  get stickyStart() {
    return this._stickyStart;
  }
  set stickyStart(value) {
    this._stickyStart = value;
    this.updateStickyState();
  }
  get scrollTop() {
    return this.verticalScrollBar.scrollPosition;
  }
  set scrollTop(value) {
    this.verticalScrollBar.scrollPosition = value;
    this.updateStickyState();
  }
  get scrollLeft() {
    return this.horizontalScrollBar.scrollPosition;
  }
  set scrollLeft(value) {
    this.horizontalScrollBar.scrollPosition = value;
    this.updateStickyState();
  }
  get scrollWidth() {
    return this.horizontalScrollBar.scrollSize;
  }
  get scrollHeight() {
    return this.verticalScrollBar.scrollSize;
  }
  updateStickyState() {
    if (!this._stickyScroll) {
      this.syncManualScrollState();
      return;
    }
    const maxScrollTop = Math.max(0, this.scrollHeight - this.viewport.height);
    const maxScrollLeft = Math.max(0, this.scrollWidth - this.viewport.width);
    if (this.scrollTop <= 0) {
      this._stickyScrollTop = true;
      this._stickyScrollBottom = false;
    } else if (this.scrollTop >= maxScrollTop) {
      this._stickyScrollTop = false;
      this._stickyScrollBottom = true;
    } else {
      this._stickyScrollTop = false;
      this._stickyScrollBottom = false;
    }
    if (this.scrollLeft <= 0) {
      this._stickyScrollLeft = true;
      this._stickyScrollRight = false;
    } else if (this.scrollLeft >= maxScrollLeft) {
      this._stickyScrollLeft = false;
      this._stickyScrollRight = true;
    } else {
      this._stickyScrollLeft = false;
      this._stickyScrollRight = false;
    }
    this.syncManualScrollState();
  }
  syncManualScrollState() {
    if (!this._stickyScroll) {
      this._hasManualScroll = false;
      return;
    }
    const maxScrollTop = Math.max(0, this.scrollHeight - this.viewport.height);
    const maxScrollLeft = Math.max(0, this.scrollWidth - this.viewport.width);
    const hasScrollableContent = maxScrollTop > 1 || maxScrollLeft > 1;
    if (this._isApplyingStickyScroll) {
      if (this._hasManualScroll && hasScrollableContent && this.isAtStickyPosition()) {
        this._hasManualScroll = false;
      }
      return;
    }
    this._hasManualScroll = hasScrollableContent && !this.isAtStickyPosition();
  }
  applyStickyStart(stickyStart) {
    const wasApplyingStickyScroll = this._isApplyingStickyScroll;
    this._isApplyingStickyScroll = true;
    try {
      switch (stickyStart) {
        case "top":
          this._stickyScrollTop = true;
          this._stickyScrollBottom = false;
          this.verticalScrollBar.scrollPosition = 0;
          break;
        case "bottom":
          this._stickyScrollTop = false;
          this._stickyScrollBottom = true;
          this.verticalScrollBar.scrollPosition = Math.max(0, this.scrollHeight - this.viewport.height);
          break;
        case "left":
          this._stickyScrollLeft = true;
          this._stickyScrollRight = false;
          this.horizontalScrollBar.scrollPosition = 0;
          break;
        case "right":
          this._stickyScrollLeft = false;
          this._stickyScrollRight = true;
          this.horizontalScrollBar.scrollPosition = Math.max(0, this.scrollWidth - this.viewport.width);
          break;
      }
    } finally {
      this._isApplyingStickyScroll = wasApplyingStickyScroll;
    }
  }
  constructor(ctx, options) {
    const {
      wrapperOptions,
      viewportOptions,
      contentOptions,
      rootOptions,
      scrollbarOptions,
      verticalScrollbarOptions,
      horizontalScrollbarOptions,
      stickyScroll = false,
      stickyStart,
      scrollX = false,
      scrollY = true,
      scrollAcceleration,
      viewportCulling = true,
      ...rootBoxOptions
    } = options;
    const forwardedContentPadding = {
      ...pickScrollBoxPadding(rootBoxOptions),
      ...pickScrollBoxPadding(rootOptions)
    };
    const sanitizedRootBoxOptions = stripScrollBoxPadding(rootBoxOptions);
    const sanitizedRootOptions = rootOptions ? stripScrollBoxPadding(rootOptions) : void 0;
    const mergedContentOptions = {
      ...forwardedContentPadding,
      ...contentOptions
    };
    super(ctx, {
      flexDirection: "row",
      alignItems: "stretch",
      ...sanitizedRootBoxOptions,
      ...sanitizedRootOptions
    });
    this._focusable = sanitizedRootOptions?.focusable ?? sanitizedRootBoxOptions.focusable ?? true;
    this.internalId = _ScrollBoxRenderable.idCounter++;
    this._stickyScroll = stickyScroll;
    this._stickyStart = stickyStart;
    if (this._stickyScroll && !this._stickyStart) {
      this._stickyScrollTop = true;
      this._stickyScrollLeft = true;
    }
    this.scrollAccel = scrollAcceleration ?? new LinearScrollAccel();
    this.wrapper = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
      ...wrapperOptions,
      id: `scroll-box-wrapper-${this.internalId}`
    });
    super.add(this.wrapper);
    this.viewport = new BoxRenderable(ctx, {
      flexDirection: "column",
      flexGrow: 1,
      // NOTE: Overflow scroll makes the content size behave weird
      // when the scrollbox is in a container with max-width/height
      overflow: "hidden",
      onSizeChange: () => {
        this.recalculateBarProps();
      },
      ...viewportOptions,
      id: `scroll-box-viewport-${this.internalId}`
    });
    this.wrapper.add(this.viewport);
    this.content = new ContentRenderable(ctx, this.viewport, viewportCulling, {
      alignSelf: "flex-start",
      flexShrink: 0,
      ...scrollX ? { minWidth: "100%" } : { minWidth: "100%", maxWidth: "100%" },
      ...scrollY ? { minHeight: "100%" } : { minHeight: "100%", maxHeight: "100%" },
      onSizeChange: () => {
        this.recalculateBarProps();
      },
      ...mergedContentOptions,
      id: `scroll-box-content-${this.internalId}`
    });
    this.viewport.add(this.content);
    this.verticalScrollBar = new ScrollBarRenderable(ctx, {
      ...scrollbarOptions,
      ...verticalScrollbarOptions,
      arrowOptions: {
        ...scrollbarOptions?.arrowOptions,
        ...verticalScrollbarOptions?.arrowOptions
      },
      id: `scroll-box-vertical-scrollbar-${this.internalId}`,
      orientation: "vertical",
      onChange: (position) => {
        this.content.translateY = -position;
        this.updateStickyState();
      }
    });
    super.add(this.verticalScrollBar);
    this.horizontalScrollBar = new ScrollBarRenderable(ctx, {
      ...scrollbarOptions,
      ...horizontalScrollbarOptions,
      arrowOptions: {
        ...scrollbarOptions?.arrowOptions,
        ...horizontalScrollbarOptions?.arrowOptions
      },
      id: `scroll-box-horizontal-scrollbar-${this.internalId}`,
      orientation: "horizontal",
      onChange: (position) => {
        this.content.translateX = -position;
        this.updateStickyState();
      }
    });
    this.wrapper.add(this.horizontalScrollBar);
    this.recalculateBarProps();
    if (stickyStart && stickyScroll) {
      this.applyStickyStart(stickyStart);
    }
    this.selectionListener = () => {
      const selection = this._ctx.getSelection();
      if (!selection || !selection.isDragging) {
        this.stopAutoScroll();
      }
    };
    this._ctx.on("selection", this.selectionListener);
  }
  onUpdate(deltaTime) {
    this.handleAutoScroll(deltaTime);
  }
  scrollBy(delta, unit = "absolute") {
    if (typeof delta === "number") {
      this.verticalScrollBar.scrollBy(delta, unit);
    } else {
      this.verticalScrollBar.scrollBy(delta.y, unit);
      this.horizontalScrollBar.scrollBy(delta.x, unit);
    }
  }
  scrollChildIntoView(childId) {
    const child = this.content.findDescendantById(childId);
    if (!child) return;
    const getNearestDelta = (elementStart, elementEnd, viewportStart, viewportEnd) => {
      const elementSize = elementEnd - elementStart;
      const viewportSize = viewportEnd - viewportStart;
      const elementStartOutside = elementStart < viewportStart;
      const elementEndOutside = elementEnd > viewportEnd;
      if (!elementStartOutside && !elementEndOutside) {
        return 0;
      }
      if (elementStartOutside && elementEndOutside) {
        return 0;
      }
      if (elementSize >= viewportSize || elementStartOutside) {
        return elementStart - viewportStart;
      }
      return elementEnd - viewportEnd;
    };
    const childTop = child.y;
    const childBottom = child.y + child.height;
    const viewportTop = this.viewport.y;
    const viewportBottom = this.viewport.y + this.viewport.height;
    const dy = getNearestDelta(childTop, childBottom, viewportTop, viewportBottom);
    const childLeft = child.x;
    const childRight = child.x + child.width;
    const viewportLeft = this.viewport.x;
    const viewportRight = this.viewport.x + this.viewport.width;
    const dx = getNearestDelta(childLeft, childRight, viewportLeft, viewportRight);
    if (dx !== 0 || dy !== 0) {
      this.scrollBy({ x: dx, y: dy });
    }
  }
  scrollTo(position) {
    if (typeof position === "number") {
      this.scrollTop = position;
    } else {
      this.scrollTop = position.y;
      this.scrollLeft = position.x;
    }
  }
  isAtStickyPosition() {
    if (!this._stickyScroll) {
      return false;
    }
    const maxScrollTop = Math.max(0, this.scrollHeight - this.viewport.height);
    const maxScrollLeft = Math.max(0, this.scrollWidth - this.viewport.width);
    if (this._stickyStart) {
      switch (this._stickyStart) {
        case "top":
          return this.scrollTop === 0;
        case "bottom":
          return this.scrollTop >= maxScrollTop;
        case "left":
          return this.scrollLeft === 0;
        case "right":
          return this.scrollLeft >= maxScrollLeft;
        default:
          return false;
      }
    }
    return this._stickyScrollTop && this.scrollTop <= 0 || this._stickyScrollBottom && this.scrollTop >= maxScrollTop || this._stickyScrollLeft && this.scrollLeft <= 0 || this._stickyScrollRight && this.scrollLeft >= maxScrollLeft;
  }
  isAtStickyReengagePoint(stickyStart, maxScrollTop, maxScrollLeft) {
    switch (stickyStart) {
      case "top":
        return maxScrollTop > 0 && this.scrollTop <= 0;
      case "bottom":
        return maxScrollTop > 0 && this.scrollTop >= maxScrollTop - 1;
      case "left":
        return maxScrollLeft > 0 && this.scrollLeft <= 0;
      case "right":
        return maxScrollLeft > 0 && this.scrollLeft >= maxScrollLeft - 1;
    }
  }
  add(obj, index) {
    return this.content.add(obj, index);
  }
  insertBefore(obj, anchor) {
    return this.content.insertBefore(obj, anchor);
  }
  remove(id) {
    this.content.remove(id);
  }
  getChildren() {
    return this.content.getChildren();
  }
  onMouseEvent(event) {
    if (event.type === "scroll") {
      let dir = event.scroll?.direction;
      if (event.modifiers.shift)
        dir = dir === "up" ? "left" : dir === "down" ? "right" : dir === "right" ? "down" : "up";
      const baseDelta = event.scroll?.delta ?? 0;
      const now = Date.now();
      const multiplier = this.scrollAccel.tick(now);
      const scrollAmount = baseDelta * multiplier;
      if (dir === "up") {
        this.scrollAccumulatorY -= scrollAmount;
        const integerScroll = Math.trunc(this.scrollAccumulatorY);
        if (integerScroll !== 0) {
          this.scrollTop += integerScroll;
          this.scrollAccumulatorY -= integerScroll;
        }
      } else if (dir === "down") {
        this.scrollAccumulatorY += scrollAmount;
        const integerScroll = Math.trunc(this.scrollAccumulatorY);
        if (integerScroll !== 0) {
          this.scrollTop += integerScroll;
          this.scrollAccumulatorY -= integerScroll;
        }
      } else if (dir === "left") {
        this.scrollAccumulatorX -= scrollAmount;
        const integerScroll = Math.trunc(this.scrollAccumulatorX);
        if (integerScroll !== 0) {
          this.scrollLeft += integerScroll;
          this.scrollAccumulatorX -= integerScroll;
        }
      } else if (dir === "right") {
        this.scrollAccumulatorX += scrollAmount;
        const integerScroll = Math.trunc(this.scrollAccumulatorX);
        if (integerScroll !== 0) {
          this.scrollLeft += integerScroll;
          this.scrollAccumulatorX -= integerScroll;
        }
      }
      this.syncManualScrollState();
    }
    if (event.type === "drag" && event.isDragging) {
      this.updateAutoScroll(event.x, event.y);
    } else if (event.type === "up") {
      this.stopAutoScroll();
    }
  }
  handleKeyPress(key) {
    if (this.verticalScrollBar.handleKeyPress(key)) {
      this.scrollAccel.reset();
      this.resetScrollAccumulators();
      this.syncManualScrollState();
      return true;
    }
    if (this.horizontalScrollBar.handleKeyPress(key)) {
      this.scrollAccel.reset();
      this.resetScrollAccumulators();
      this.syncManualScrollState();
      return true;
    }
    return false;
  }
  resetScrollAccumulators() {
    this.scrollAccumulatorX = 0;
    this.scrollAccumulatorY = 0;
  }
  startAutoScroll(mouseX, mouseY) {
    this.stopAutoScroll();
    this.autoScrollMouseX = mouseX;
    this.autoScrollMouseY = mouseY;
    this.cachedAutoScrollSpeed = this.getAutoScrollSpeed(mouseX, mouseY);
    this.isAutoScrolling = true;
    if (!this.live) {
      this.live = true;
    }
  }
  updateAutoScroll(mouseX, mouseY) {
    this.autoScrollMouseX = mouseX;
    this.autoScrollMouseY = mouseY;
    this.cachedAutoScrollSpeed = this.getAutoScrollSpeed(mouseX, mouseY);
    const scrollX = this.getAutoScrollDirectionX(mouseX);
    const scrollY = this.getAutoScrollDirectionY(mouseY);
    if (scrollX === 0 && scrollY === 0) {
      this.stopAutoScroll();
    } else if (!this.isAutoScrolling) {
      this.startAutoScroll(mouseX, mouseY);
    }
  }
  stopAutoScroll() {
    const wasAutoScrolling = this.isAutoScrolling;
    this.isAutoScrolling = false;
    this.autoScrollAccumulatorX = 0;
    this.autoScrollAccumulatorY = 0;
    if (wasAutoScrolling && !this.hasOtherLiveReasons()) {
      this.live = false;
    }
  }
  hasOtherLiveReasons() {
    return false;
  }
  handleAutoScroll(deltaTime) {
    if (!this.isAutoScrolling) return;
    const scrollX = this.getAutoScrollDirectionX(this.autoScrollMouseX);
    const scrollY = this.getAutoScrollDirectionY(this.autoScrollMouseY);
    const scrollAmount = this.cachedAutoScrollSpeed * (deltaTime / 1e3);
    let scrolled = false;
    if (scrollX !== 0) {
      this.autoScrollAccumulatorX += scrollX * scrollAmount;
      const integerScrollX = Math.trunc(this.autoScrollAccumulatorX);
      if (integerScrollX !== 0) {
        this.scrollLeft += integerScrollX;
        this.autoScrollAccumulatorX -= integerScrollX;
        scrolled = true;
      }
    }
    if (scrollY !== 0) {
      this.autoScrollAccumulatorY += scrollY * scrollAmount;
      const integerScrollY = Math.trunc(this.autoScrollAccumulatorY);
      if (integerScrollY !== 0) {
        this.scrollTop += integerScrollY;
        this.autoScrollAccumulatorY -= integerScrollY;
        scrolled = true;
      }
    }
    if (scrolled) {
      this._ctx.requestSelectionUpdate();
    }
    if (scrollX === 0 && scrollY === 0) {
      this.stopAutoScroll();
    }
  }
  getAutoScrollDirectionX(mouseX) {
    const relativeX = mouseX - this.x;
    const distToLeft = relativeX;
    const distToRight = this.width - relativeX;
    if (distToLeft <= this.autoScrollThresholdHorizontal) {
      return this.scrollLeft > 0 ? -1 : 0;
    } else if (distToRight <= this.autoScrollThresholdHorizontal) {
      const maxScrollLeft = this.scrollWidth - this.viewport.width;
      return this.scrollLeft < maxScrollLeft ? 1 : 0;
    }
    return 0;
  }
  getAutoScrollDirectionY(mouseY) {
    const relativeY = mouseY - this.y;
    const distToTop = relativeY;
    const distToBottom = this.height - relativeY;
    if (distToTop <= this.autoScrollThresholdVertical) {
      return this.scrollTop > 0 ? -1 : 0;
    } else if (distToBottom <= this.autoScrollThresholdVertical) {
      const maxScrollTop = this.scrollHeight - this.viewport.height;
      return this.scrollTop < maxScrollTop ? 1 : 0;
    }
    return 0;
  }
  getAutoScrollSpeed(mouseX, mouseY) {
    const relativeX = mouseX - this.x;
    const relativeY = mouseY - this.y;
    const distToLeft = relativeX;
    const distToRight = this.width - relativeX;
    const distToTop = relativeY;
    const distToBottom = this.height - relativeY;
    const minDistance = Math.min(distToLeft, distToRight, distToTop, distToBottom);
    if (minDistance <= 1) {
      return this.autoScrollSpeedFast;
    } else if (minDistance <= 2) {
      return this.autoScrollSpeedMedium;
    } else {
      return this.autoScrollSpeedSlow;
    }
  }
  recalculateBarProps() {
    const wasApplyingStickyScroll = this._isApplyingStickyScroll;
    this._isApplyingStickyScroll = true;
    try {
      if (this._stickyScroll) {
        this.updateStickyState();
      }
      this.verticalScrollBar.scrollSize = this.content.height;
      this.verticalScrollBar.viewportSize = this.viewport.height;
      this.horizontalScrollBar.scrollSize = this.content.width;
      this.horizontalScrollBar.viewportSize = this.viewport.width;
      if (this._stickyScroll) {
        const newMaxScrollTop = Math.max(0, this.scrollHeight - this.viewport.height);
        const newMaxScrollLeft = Math.max(0, this.scrollWidth - this.viewport.width);
        const stickyStart = this._stickyStart;
        if (stickyStart && !this._hasManualScroll) {
          this.applyStickyStart(stickyStart);
        } else if (stickyStart && this._hasManualScroll && this.isAtStickyReengagePoint(stickyStart, newMaxScrollTop, newMaxScrollLeft)) {
          this._hasManualScroll = false;
          this.applyStickyStart(stickyStart);
        } else if (!this._hasManualScroll) {
          if (this._stickyScrollTop) {
            this.scrollTop = 0;
          } else if (this._stickyScrollBottom && newMaxScrollTop > 0) {
            this.scrollTop = newMaxScrollTop;
          }
          if (this._stickyScrollLeft) {
            this.scrollLeft = 0;
          } else if (this._stickyScrollRight && newMaxScrollLeft > 0) {
            this.scrollLeft = newMaxScrollLeft;
          }
        }
      }
    } finally {
      this._isApplyingStickyScroll = wasApplyingStickyScroll;
    }
    process.nextTick(() => {
      this.requestRender();
    });
  }
  // Setters for reactive properties
  set padding(value) {
    this.content.padding = value;
    this.requestRender();
  }
  set paddingX(value) {
    this.content.paddingX = value;
    this.requestRender();
  }
  set paddingY(value) {
    this.content.paddingY = value;
    this.requestRender();
  }
  set paddingTop(value) {
    this.content.paddingTop = value;
    this.requestRender();
  }
  set paddingRight(value) {
    this.content.paddingRight = value;
    this.requestRender();
  }
  set paddingBottom(value) {
    this.content.paddingBottom = value;
    this.requestRender();
  }
  set paddingLeft(value) {
    this.content.paddingLeft = value;
    this.requestRender();
  }
  set rootOptions(options) {
    Object.assign(this, options);
    this.requestRender();
  }
  set wrapperOptions(options) {
    Object.assign(this.wrapper, options);
    this.requestRender();
  }
  set viewportOptions(options) {
    Object.assign(this.viewport, options);
    this.requestRender();
  }
  set contentOptions(options) {
    Object.assign(this.content, options);
    this.requestRender();
  }
  set scrollbarOptions(options) {
    Object.assign(this.verticalScrollBar, options);
    Object.assign(this.horizontalScrollBar, options);
    this.requestRender();
  }
  set verticalScrollbarOptions(options) {
    Object.assign(this.verticalScrollBar, options);
    this.requestRender();
  }
  set horizontalScrollbarOptions(options) {
    Object.assign(this.horizontalScrollBar, options);
    this.requestRender();
  }
  get scrollAcceleration() {
    return this.scrollAccel;
  }
  set scrollAcceleration(value) {
    this.scrollAccel = value;
  }
  get viewportCulling() {
    return this.content.viewportCulling;
  }
  set viewportCulling(value) {
    this.content.viewportCulling = value;
    this.requestRender();
  }
  destroySelf() {
    if (this.selectionListener) {
      this._ctx.off("selection", this.selectionListener);
      this.selectionListener = void 0;
    }
    super.destroySelf();
  }
};

// src/renderables/Select.ts
var defaultSelectKeybindings = [
  { name: "up", action: "move-up" },
  { name: "k", action: "move-up" },
  { name: "down", action: "move-down" },
  { name: "j", action: "move-down" },
  { name: "up", shift: true, action: "move-up-fast" },
  { name: "down", shift: true, action: "move-down-fast" },
  { name: "return", action: "select-current" },
  { name: "linefeed", action: "select-current" }
];
var SelectRenderableEvents = /* @__PURE__ */ ((SelectRenderableEvents2) => {
  SelectRenderableEvents2["SELECTION_CHANGED"] = "selectionChanged";
  SelectRenderableEvents2["ITEM_SELECTED"] = "itemSelected";
  return SelectRenderableEvents2;
})(SelectRenderableEvents || {});
var SelectRenderable = class extends Renderable {
  _focusable = true;
  _options = [];
  _selectedIndex = 0;
  scrollOffset = 0;
  maxVisibleItems;
  _backgroundColor;
  _textColor;
  _focusedBackgroundColor;
  _focusedTextColor;
  _selectedBackgroundColor;
  _selectedTextColor;
  _descriptionColor;
  _selectedDescriptionColor;
  _showScrollIndicator;
  _wrapSelection;
  _showDescription;
  _font;
  _itemSpacing;
  linesPerItem;
  fontHeight;
  _fastScrollStep;
  _keyBindingsMap;
  _keyAliasMap;
  _keyBindings;
  _defaultOptions = {
    backgroundColor: "transparent",
    textColor: "#FFFFFF",
    focusedBackgroundColor: "#1a1a1a",
    focusedTextColor: "#FFFFFF",
    selectedBackgroundColor: "#334455",
    selectedTextColor: "#FFFF00",
    selectedIndex: 0,
    descriptionColor: "#888888",
    selectedDescriptionColor: "#CCCCCC",
    showScrollIndicator: false,
    wrapSelection: false,
    showDescription: true,
    itemSpacing: 0,
    fastScrollStep: 5
  };
  constructor(ctx, options) {
    super(ctx, { ...options, buffered: true });
    this._focusable = options.focusable ?? true;
    this._options = options.options || [];
    const requestedIndex = options.selectedIndex ?? this._defaultOptions.selectedIndex;
    this._selectedIndex = this._options.length > 0 ? clamp(Number.isFinite(requestedIndex) ? requestedIndex : 0, 0, this._options.length - 1) : 0;
    this._backgroundColor = parseColor(options.backgroundColor || this._defaultOptions.backgroundColor);
    this._textColor = parseColor(options.textColor || this._defaultOptions.textColor);
    this._focusedBackgroundColor = parseColor(
      options.focusedBackgroundColor || this._defaultOptions.focusedBackgroundColor
    );
    this._focusedTextColor = parseColor(options.focusedTextColor || this._defaultOptions.focusedTextColor);
    this._showScrollIndicator = options.showScrollIndicator ?? this._defaultOptions.showScrollIndicator;
    this._wrapSelection = options.wrapSelection ?? this._defaultOptions.wrapSelection;
    this._showDescription = options.showDescription ?? this._defaultOptions.showDescription;
    this._font = options.font;
    this._itemSpacing = options.itemSpacing || this._defaultOptions.itemSpacing;
    this.fontHeight = this._font ? measureText({ text: "A", font: this._font }).height : 1;
    this.linesPerItem = this._showDescription ? this._font ? this.fontHeight + 1 : 2 : this._font ? this.fontHeight : 1;
    this.linesPerItem += this._itemSpacing;
    this.maxVisibleItems = Math.max(1, Math.floor(this.height / this.linesPerItem));
    this._selectedBackgroundColor = parseColor(
      options.selectedBackgroundColor || this._defaultOptions.selectedBackgroundColor
    );
    this._selectedTextColor = parseColor(options.selectedTextColor || this._defaultOptions.selectedTextColor);
    this._descriptionColor = parseColor(options.descriptionColor || this._defaultOptions.descriptionColor);
    this._selectedDescriptionColor = parseColor(
      options.selectedDescriptionColor || this._defaultOptions.selectedDescriptionColor
    );
    this._fastScrollStep = options.fastScrollStep || this._defaultOptions.fastScrollStep;
    this._keyAliasMap = mergeKeyAliases(defaultKeyAliases, options.keyAliasMap || {});
    this._keyBindings = options.keyBindings || [];
    const mergedBindings = mergeKeyBindings(defaultSelectKeybindings, this._keyBindings);
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap);
    this.requestRender();
  }
  renderSelf(buffer, deltaTime) {
    if (!this.visible || !this.frameBuffer) return;
    if (this.isDirty) {
      this.refreshFrameBuffer();
    }
  }
  refreshFrameBuffer() {
    if (!this.frameBuffer) return;
    const bgColor = this._focused ? this._focusedBackgroundColor : this._backgroundColor;
    this.frameBuffer.clear(bgColor);
    if (this._options.length === 0) return;
    const contentX = 0;
    const contentY = 0;
    const contentWidth = this.width;
    const contentHeight = this.height;
    const visibleOptions = this._options.slice(this.scrollOffset, this.scrollOffset + this.maxVisibleItems);
    for (let i = 0; i < visibleOptions.length; i++) {
      const actualIndex = this.scrollOffset + i;
      const option = visibleOptions[i];
      const isSelected = actualIndex === this._selectedIndex;
      const itemY = contentY + i * this.linesPerItem;
      if (itemY + this.linesPerItem - 1 >= contentY + contentHeight) break;
      if (isSelected) {
        const contentHeight2 = this.linesPerItem - this._itemSpacing;
        this.frameBuffer.fillRect(contentX, itemY, contentWidth, contentHeight2, this._selectedBackgroundColor);
      }
      const nameContent = `${isSelected ? "\u25B6 " : "  "}${option.name}`;
      const baseTextColor = this._focused ? this._focusedTextColor : this._textColor;
      const nameColor = isSelected ? this._selectedTextColor : baseTextColor;
      let descX = contentX + 3;
      if (this._font) {
        const indicator = isSelected ? "\u25B6 " : "  ";
        this.frameBuffer.drawText(indicator, contentX + 1, itemY, nameColor);
        const indicatorWidth = 2;
        renderFontToFrameBuffer(this.frameBuffer, {
          text: option.name,
          x: contentX + 1 + indicatorWidth,
          y: itemY,
          color: nameColor,
          backgroundColor: isSelected ? this._selectedBackgroundColor : bgColor,
          font: this._font
        });
        descX = contentX + 1 + indicatorWidth;
      } else {
        this.frameBuffer.drawText(nameContent, contentX + 1, itemY, nameColor);
      }
      if (this._showDescription && itemY + this.fontHeight < contentY + contentHeight) {
        const descColor = isSelected ? this._selectedDescriptionColor : this._descriptionColor;
        this.frameBuffer.drawText(option.description, descX, itemY + this.fontHeight, descColor);
      }
    }
    if (this._showScrollIndicator && this._options.length > this.maxVisibleItems) {
      this.renderScrollIndicatorToFrameBuffer(contentX, contentY, contentWidth, contentHeight);
    }
  }
  renderScrollIndicatorToFrameBuffer(contentX, contentY, contentWidth, contentHeight) {
    if (!this.frameBuffer) return;
    const scrollPercent = this._selectedIndex / Math.max(1, this._options.length - 1);
    const indicatorHeight = Math.max(1, contentHeight - 2);
    const indicatorY = contentY + 1 + Math.floor(scrollPercent * indicatorHeight);
    const indicatorX = contentX + contentWidth - 1;
    this.frameBuffer.drawText("\u2588", indicatorX, indicatorY, parseColor("#666666"));
  }
  get options() {
    return this._options;
  }
  set options(options) {
    this._options = options;
    this._selectedIndex = clamp(this._selectedIndex, 0, Math.max(0, options.length - 1));
    this.updateScrollOffset();
    this.requestRender();
  }
  getSelectedOption() {
    return this._options[this._selectedIndex] || null;
  }
  getSelectedIndex() {
    return this._selectedIndex;
  }
  moveUp(steps = 1) {
    if (this._options.length === 0) return;
    const newIndex = this._selectedIndex - steps;
    if (newIndex >= 0) {
      this._selectedIndex = newIndex;
    } else if (this._wrapSelection && this._options.length > 0) {
      this._selectedIndex = this._options.length - 1;
    } else {
      this._selectedIndex = 0;
    }
    this.updateScrollOffset();
    this.requestRender();
    this.emit("selectionChanged" /* SELECTION_CHANGED */, this._selectedIndex, this.getSelectedOption());
  }
  moveDown(steps = 1) {
    if (this._options.length === 0) return;
    const newIndex = this._selectedIndex + steps;
    if (newIndex < this._options.length) {
      this._selectedIndex = newIndex;
    } else if (this._wrapSelection && this._options.length > 0) {
      this._selectedIndex = 0;
    } else {
      this._selectedIndex = this._options.length - 1;
    }
    this.updateScrollOffset();
    this.requestRender();
    this.emit("selectionChanged" /* SELECTION_CHANGED */, this._selectedIndex, this.getSelectedOption());
  }
  selectCurrent() {
    const selected = this.getSelectedOption();
    if (selected) {
      this.emit("itemSelected" /* ITEM_SELECTED */, this._selectedIndex, selected);
    }
  }
  setSelectedIndex(index) {
    if (index >= 0 && index < this._options.length) {
      this._selectedIndex = index;
      this.updateScrollOffset();
      this.requestRender();
      this.emit("selectionChanged" /* SELECTION_CHANGED */, this._selectedIndex, this.getSelectedOption());
    }
  }
  updateScrollOffset() {
    if (!this._options) return;
    const halfVisible = Math.floor(this.maxVisibleItems / 2);
    const newScrollOffset = Math.max(
      0,
      Math.min(this._selectedIndex - halfVisible, this._options.length - this.maxVisibleItems)
    );
    if (newScrollOffset !== this.scrollOffset) {
      this.scrollOffset = newScrollOffset;
      this.requestRender();
    }
  }
  onResize(width, height) {
    this.maxVisibleItems = Math.max(1, Math.floor(height / this.linesPerItem));
    this.updateScrollOffset();
    this.requestRender();
  }
  handleKeyPress(key) {
    const action = getKeyBindingAction(this._keyBindingsMap, key);
    if (action) {
      switch (action) {
        case "move-up":
          this.moveUp(1);
          return true;
        case "move-down":
          this.moveDown(1);
          return true;
        case "move-up-fast":
          this.moveUp(this._fastScrollStep);
          return true;
        case "move-down-fast":
          this.moveDown(this._fastScrollStep);
          return true;
        case "select-current":
          this.selectCurrent();
          return true;
      }
    }
    return false;
  }
  get showScrollIndicator() {
    return this._showScrollIndicator;
  }
  set showScrollIndicator(show) {
    this._showScrollIndicator = show;
    this.requestRender();
  }
  get showDescription() {
    return this._showDescription;
  }
  updateLinesPerItem() {
    this.linesPerItem = this._showDescription ? this._font ? this.fontHeight + 1 : 2 : this._font ? this.fontHeight : 1;
    this.linesPerItem += this._itemSpacing;
    this.maxVisibleItems = Math.max(1, Math.floor(this.height / this.linesPerItem));
  }
  set showDescription(show) {
    if (this._showDescription !== show) {
      this._showDescription = show;
      this.updateLinesPerItem();
      this.updateScrollOffset();
      this.requestRender();
    }
  }
  get wrapSelection() {
    return this._wrapSelection;
  }
  set wrapSelection(wrap) {
    this._wrapSelection = wrap;
  }
  set backgroundColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.backgroundColor);
    if (this._backgroundColor !== newColor) {
      this._backgroundColor = newColor;
      this.requestRender();
    }
  }
  set textColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.textColor);
    if (this._textColor !== newColor) {
      this._textColor = newColor;
      this.requestRender();
    }
  }
  set focusedBackgroundColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.focusedBackgroundColor);
    if (this._focusedBackgroundColor !== newColor) {
      this._focusedBackgroundColor = newColor;
      this.requestRender();
    }
  }
  set focusedTextColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.focusedTextColor);
    if (this._focusedTextColor !== newColor) {
      this._focusedTextColor = newColor;
      this.requestRender();
    }
  }
  set selectedBackgroundColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.selectedBackgroundColor);
    if (this._selectedBackgroundColor !== newColor) {
      this._selectedBackgroundColor = newColor;
      this.requestRender();
    }
  }
  set selectedTextColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.selectedTextColor);
    if (this._selectedTextColor !== newColor) {
      this._selectedTextColor = newColor;
      this.requestRender();
    }
  }
  set descriptionColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.descriptionColor);
    if (this._descriptionColor !== newColor) {
      this._descriptionColor = newColor;
      this.requestRender();
    }
  }
  set selectedDescriptionColor(value) {
    const newColor = parseColor(value ?? this._defaultOptions.selectedDescriptionColor);
    if (this._selectedDescriptionColor !== newColor) {
      this._selectedDescriptionColor = newColor;
      this.requestRender();
    }
  }
  set font(font) {
    this._font = font;
    this.fontHeight = measureText({ text: "A", font: this._font }).height;
    this.updateLinesPerItem();
    this.updateScrollOffset();
    this.requestRender();
  }
  set itemSpacing(spacing) {
    this._itemSpacing = spacing;
    this.updateLinesPerItem();
    this.updateScrollOffset();
    this.requestRender();
  }
  set fastScrollStep(step) {
    this._fastScrollStep = step;
  }
  set keyBindings(bindings) {
    this._keyBindings = bindings;
    const mergedBindings = mergeKeyBindings(defaultSelectKeybindings, bindings);
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap);
  }
  set keyAliasMap(aliases2) {
    this._keyAliasMap = mergeKeyAliases(defaultKeyAliases, aliases2);
    const mergedBindings = mergeKeyBindings(defaultSelectKeybindings, this._keyBindings);
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap);
  }
  set selectedIndex(value) {
    const newIndex = value ?? this._defaultOptions.selectedIndex;
    const clampedIndex = this._options.length > 0 ? clamp(newIndex, 0, this._options.length - 1) : 0;
    if (this._selectedIndex !== clampedIndex) {
      this._selectedIndex = clampedIndex;
      this.updateScrollOffset();
      this.requestRender();
    }
  }
};

// src/renderables/TabSelect.ts
var defaultTabSelectKeybindings = [
  { name: "left", action: "move-left" },
  { name: "[", action: "move-left" },
  { name: "right", action: "move-right" },
  { name: "]", action: "move-right" },
  { name: "return", action: "select-current" },
  { name: "linefeed", action: "select-current" }
];
var TabSelectRenderableEvents = /* @__PURE__ */ ((TabSelectRenderableEvents2) => {
  TabSelectRenderableEvents2["SELECTION_CHANGED"] = "selectionChanged";
  TabSelectRenderableEvents2["ITEM_SELECTED"] = "itemSelected";
  return TabSelectRenderableEvents2;
})(TabSelectRenderableEvents || {});
function calculateDynamicHeight(showUnderline, showDescription) {
  let height = 1;
  if (showUnderline) {
    height += 1;
  }
  if (showDescription) {
    height += 1;
  }
  return height;
}
var TabSelectRenderable = class extends Renderable {
  _focusable = true;
  _options = [];
  selectedIndex = 0;
  scrollOffset = 0;
  _tabWidth;
  maxVisibleTabs;
  _backgroundColor;
  _textColor;
  _focusedBackgroundColor;
  _focusedTextColor;
  _selectedBackgroundColor;
  _selectedTextColor;
  _selectedDescriptionColor;
  _showScrollArrows;
  _showDescription;
  _showUnderline;
  _wrapSelection;
  _keyBindingsMap;
  _keyAliasMap;
  _keyBindings;
  constructor(ctx, options) {
    const calculatedHeight = calculateDynamicHeight(options.showUnderline ?? true, options.showDescription ?? true);
    super(ctx, { ...options, height: calculatedHeight, buffered: true });
    this._focusable = options.focusable ?? true;
    this._backgroundColor = parseColor(options.backgroundColor || "transparent");
    this._textColor = parseColor(options.textColor || "#FFFFFF");
    this._focusedBackgroundColor = parseColor(options.focusedBackgroundColor || options.backgroundColor || "#1a1a1a");
    this._focusedTextColor = parseColor(options.focusedTextColor || options.textColor || "#FFFFFF");
    this._options = options.options || [];
    this._tabWidth = options.tabWidth || 20;
    this._showDescription = options.showDescription ?? true;
    this._showUnderline = options.showUnderline ?? true;
    this._showScrollArrows = options.showScrollArrows ?? true;
    this._wrapSelection = options.wrapSelection ?? false;
    this.maxVisibleTabs = Math.max(1, Math.floor(this.width / this._tabWidth));
    this._selectedBackgroundColor = parseColor(options.selectedBackgroundColor || "#334455");
    this._selectedTextColor = parseColor(options.selectedTextColor || "#FFFF00");
    this._selectedDescriptionColor = parseColor(options.selectedDescriptionColor || "#CCCCCC");
    this._keyAliasMap = mergeKeyAliases(defaultKeyAliases, options.keyAliasMap || {});
    this._keyBindings = options.keyBindings || [];
    const mergedBindings = mergeKeyBindings(defaultTabSelectKeybindings, this._keyBindings);
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap);
  }
  calculateDynamicHeight() {
    return calculateDynamicHeight(this._showUnderline, this._showDescription);
  }
  renderSelf(buffer, deltaTime) {
    if (!this.visible || !this.frameBuffer) return;
    if (this.isDirty) {
      this.refreshFrameBuffer();
    }
  }
  refreshFrameBuffer() {
    if (!this.frameBuffer) return;
    const bgColor = this._focused ? this._focusedBackgroundColor : this._backgroundColor;
    this.frameBuffer.clear(bgColor);
    if (this._options.length === 0) return;
    const contentX = 0;
    const contentY = 0;
    const contentWidth = this.width;
    const contentHeight = this.height;
    const visibleOptions = this._options.slice(this.scrollOffset, this.scrollOffset + this.maxVisibleTabs);
    for (let i = 0; i < visibleOptions.length; i++) {
      const actualIndex = this.scrollOffset + i;
      const option = visibleOptions[i];
      const isSelected = actualIndex === this.selectedIndex;
      const tabX = contentX + i * this._tabWidth;
      if (tabX >= contentX + contentWidth) break;
      const actualTabWidth = Math.min(this._tabWidth, contentWidth - i * this._tabWidth);
      if (isSelected) {
        this.frameBuffer.fillRect(tabX, contentY, actualTabWidth, 1, this._selectedBackgroundColor);
      }
      const baseTextColor = this._focused ? this._focusedTextColor : this._textColor;
      const nameColor = isSelected ? this._selectedTextColor : baseTextColor;
      const nameContent = this.truncateText(option.name, actualTabWidth - 2);
      this.frameBuffer.drawText(nameContent, tabX + 1, contentY, nameColor);
      if (isSelected && this._showUnderline && contentHeight >= 2) {
        const underlineY = contentY + 1;
        const underlineBg = isSelected ? this._selectedBackgroundColor : bgColor;
        this.frameBuffer.drawText("\u25AC".repeat(actualTabWidth), tabX, underlineY, nameColor, underlineBg);
      }
    }
    if (this._showDescription && contentHeight >= (this._showUnderline ? 3 : 2)) {
      const selectedOption = this.getSelectedOption();
      if (selectedOption) {
        const descriptionY = contentY + (this._showUnderline ? 2 : 1);
        const descColor = this._selectedDescriptionColor;
        const descContent = this.truncateText(selectedOption.description, contentWidth - 2);
        this.frameBuffer.drawText(descContent, contentX + 1, descriptionY, descColor);
      }
    }
    if (this._showScrollArrows && this._options.length > this.maxVisibleTabs) {
      this.renderScrollArrowsToFrameBuffer(contentX, contentY, contentWidth, contentHeight);
    }
  }
  truncateText(text, maxWidth) {
    if (text.length <= maxWidth) return text;
    return text.substring(0, Math.max(0, maxWidth - 1)) + "\u2026";
  }
  renderScrollArrowsToFrameBuffer(contentX, contentY, contentWidth, contentHeight) {
    if (!this.frameBuffer) return;
    const hasMoreLeft = this.scrollOffset > 0;
    const hasMoreRight = this.scrollOffset + this.maxVisibleTabs < this._options.length;
    if (hasMoreLeft) {
      this.frameBuffer.drawText("\u2039", contentX, contentY, parseColor("#AAAAAA"));
    }
    if (hasMoreRight) {
      this.frameBuffer.drawText("\u203A", contentX + contentWidth - 1, contentY, parseColor("#AAAAAA"));
    }
  }
  setOptions(options) {
    this._options = options;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, options.length - 1));
    this.updateScrollOffset();
    this.requestRender();
  }
  getSelectedOption() {
    return this._options[this.selectedIndex] || null;
  }
  getSelectedIndex() {
    return this.selectedIndex;
  }
  moveLeft() {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
    } else if (this._wrapSelection && this._options.length > 0) {
      this.selectedIndex = this._options.length - 1;
    } else {
      return;
    }
    this.updateScrollOffset();
    this.requestRender();
    this.emit("selectionChanged" /* SELECTION_CHANGED */, this.selectedIndex, this.getSelectedOption());
  }
  moveRight() {
    if (this.selectedIndex < this._options.length - 1) {
      this.selectedIndex++;
    } else if (this._wrapSelection && this._options.length > 0) {
      this.selectedIndex = 0;
    } else {
      return;
    }
    this.updateScrollOffset();
    this.requestRender();
    this.emit("selectionChanged" /* SELECTION_CHANGED */, this.selectedIndex, this.getSelectedOption());
  }
  selectCurrent() {
    const selected = this.getSelectedOption();
    if (selected) {
      this.emit("itemSelected" /* ITEM_SELECTED */, this.selectedIndex, selected);
    }
  }
  setSelectedIndex(index) {
    if (index >= 0 && index < this._options.length) {
      this.selectedIndex = index;
      this.updateScrollOffset();
      this.requestRender();
      this.emit("selectionChanged" /* SELECTION_CHANGED */, this.selectedIndex, this.getSelectedOption());
    }
  }
  updateScrollOffset() {
    const halfVisible = Math.floor(this.maxVisibleTabs / 2);
    const newScrollOffset = Math.max(
      0,
      Math.min(this.selectedIndex - halfVisible, this._options.length - this.maxVisibleTabs)
    );
    if (newScrollOffset !== this.scrollOffset) {
      this.scrollOffset = newScrollOffset;
      this.requestRender();
    }
  }
  onResize(width, height) {
    this.maxVisibleTabs = Math.max(1, Math.floor(width / this._tabWidth));
    this.updateScrollOffset();
    this.requestRender();
  }
  setTabWidth(tabWidth) {
    if (this._tabWidth === tabWidth) return;
    this._tabWidth = tabWidth;
    this.maxVisibleTabs = Math.max(1, Math.floor(this.width / this._tabWidth));
    this.updateScrollOffset();
    this.requestRender();
  }
  getTabWidth() {
    return this._tabWidth;
  }
  handleKeyPress(key) {
    const action = getKeyBindingAction(this._keyBindingsMap, key);
    if (action) {
      switch (action) {
        case "move-left":
          this.moveLeft();
          return true;
        case "move-right":
          this.moveRight();
          return true;
        case "select-current":
          this.selectCurrent();
          return true;
      }
    }
    return false;
  }
  get options() {
    return this._options;
  }
  set options(options) {
    this._options = options;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, options.length - 1));
    this.updateScrollOffset();
    this.requestRender();
  }
  set backgroundColor(color) {
    this._backgroundColor = parseColor(color);
    this.requestRender();
  }
  set textColor(color) {
    this._textColor = parseColor(color);
    this.requestRender();
  }
  set focusedBackgroundColor(color) {
    this._focusedBackgroundColor = parseColor(color);
    this.requestRender();
  }
  set focusedTextColor(color) {
    this._focusedTextColor = parseColor(color);
    this.requestRender();
  }
  set selectedBackgroundColor(color) {
    this._selectedBackgroundColor = parseColor(color);
    this.requestRender();
  }
  set selectedTextColor(color) {
    this._selectedTextColor = parseColor(color);
    this.requestRender();
  }
  set selectedDescriptionColor(color) {
    this._selectedDescriptionColor = parseColor(color);
    this.requestRender();
  }
  get showDescription() {
    return this._showDescription;
  }
  set showDescription(show) {
    if (this._showDescription !== show) {
      this._showDescription = show;
      const newHeight = this.calculateDynamicHeight();
      this.height = newHeight;
      this.requestRender();
    }
  }
  get showUnderline() {
    return this._showUnderline;
  }
  set showUnderline(show) {
    if (this._showUnderline !== show) {
      this._showUnderline = show;
      const newHeight = this.calculateDynamicHeight();
      this.height = newHeight;
      this.requestRender();
    }
  }
  get showScrollArrows() {
    return this._showScrollArrows;
  }
  set showScrollArrows(show) {
    if (this._showScrollArrows !== show) {
      this._showScrollArrows = show;
      this.requestRender();
    }
  }
  get wrapSelection() {
    return this._wrapSelection;
  }
  set wrapSelection(wrap) {
    this._wrapSelection = wrap;
  }
  get tabWidth() {
    return this._tabWidth;
  }
  set tabWidth(tabWidth) {
    if (this._tabWidth === tabWidth) return;
    this._tabWidth = tabWidth;
    this.maxVisibleTabs = Math.max(1, Math.floor(this.width / this._tabWidth));
    this.updateScrollOffset();
    this.requestRender();
  }
  set keyBindings(bindings) {
    this._keyBindings = bindings;
    const mergedBindings = mergeKeyBindings(defaultTabSelectKeybindings, bindings);
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap);
  }
  set keyAliasMap(aliases2) {
    this._keyAliasMap = mergeKeyAliases(defaultKeyAliases, aliases2);
    const mergedBindings = mergeKeyBindings(defaultTabSelectKeybindings, this._keyBindings);
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap);
  }
};

// src/renderables/TimeToFirstDraw.ts
var TimeToFirstDrawRenderable = class extends Renderable {
  _runtimeMs = null;
  textColor;
  label;
  precision;
  constructor(ctx, options = {}) {
    super(ctx, {
      width: "100%",
      height: 1,
      flexShrink: 0,
      alignSelf: "center",
      ...options
    });
    this.textColor = parseColor(options.fg ?? "#AAAAAA");
    this.label = options.label ?? "Time to first draw";
    this.precision = this.normalizePrecision(options.precision ?? 2);
  }
  get runtimeMs() {
    return this._runtimeMs;
  }
  set fg(value) {
    this.textColor = parseColor(value);
    this.requestRender();
  }
  set color(value) {
    this.fg = value;
  }
  set textLabel(value) {
    if (value === this.label) {
      return;
    }
    this.label = value;
    this.requestRender();
  }
  set decimals(value) {
    const nextPrecision = this.normalizePrecision(value);
    if (nextPrecision === this.precision) {
      return;
    }
    this.precision = nextPrecision;
    this.requestRender();
  }
  reset() {
    this._runtimeMs = null;
    this.requestRender();
  }
  renderSelf(buffer) {
    if (this._runtimeMs === null) {
      this._runtimeMs = performance.now();
    }
    const content = `${this.label}: ${this._runtimeMs.toFixed(this.precision)}ms`;
    const maxWidth = Math.max(this.width, 1);
    const visibleContent = content.length > maxWidth ? content.slice(0, maxWidth) : content;
    const centeredX = this.x + Math.max(0, Math.floor((maxWidth - visibleContent.length) / 2));
    buffer.drawText(visibleContent, centeredX, this.y, this.textColor);
  }
  normalizePrecision(value) {
    if (!Number.isFinite(value)) {
      return 2;
    }
    return Math.max(0, Math.floor(value));
  }
};

// src/lib/virtual-list.ts
var MAX_HEIGHT = 1e6;
var MAX_TOTAL_HEIGHT = 1e9;
function heightValue(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_HEIGHT) {
    throw new RangeError(`Virtual row height must be an integer from 1 to ${MAX_HEIGHT}`);
  }
  return value;
}
var VirtualListModel = class {
  constructor(getKey, estimateHeight = 1) {
    this.getKey = getKey;
    this.estimateHeight = heightValue(estimateHeight);
  }
  getKey;
  values = [];
  keys = [];
  indices = /* @__PURE__ */ new Map();
  heights = [];
  tree = new Float64Array(1);
  measured = /* @__PURE__ */ new Map();
  total = 0;
  estimateHeight;
  get items() {
    return this.values;
  }
  get count() {
    return this.values.length;
  }
  get totalHeight() {
    return this.total;
  }
  setItems(items) {
    const values = [...items];
    const keys = [];
    const indices = /* @__PURE__ */ new Map();
    const measured = /* @__PURE__ */ new Map();
    const heights = values.map((item, index) => {
      const key = this.getKey(item);
      if (typeof key !== "string" && typeof key !== "number" || typeof key === "number" && !Number.isFinite(key) || indices.has(key)) {
        throw new TypeError("Virtual list keys must be unique strings or finite numbers");
      }
      keys.push(key);
      indices.set(key, index);
      const old = this.measured.get(key);
      if (old && Object.is(old.item, item)) {
        measured.set(key, old);
        return old.height;
      }
      return this.estimateHeight;
    });
    const total = heights.reduce((sum, height) => sum + height, 0);
    if (total > MAX_TOTAL_HEIGHT) throw new RangeError("Virtual list exceeds maximum total height");
    this.values = values;
    this.keys = keys;
    this.indices = indices;
    this.heights = heights;
    this.measured = measured;
    this.total = total;
    this.rebuild();
  }
  rebuild() {
    this.tree = new Float64Array(this.count + 1);
    for (let index = 1; index <= this.count; index++) {
      this.tree[index] += this.heights[index - 1];
      const parent = index + (index & -index);
      if (parent <= this.count) this.tree[parent] += this.tree[index];
    }
  }
  resetMeasurements() {
    const total = this.count * this.estimateHeight;
    if (total > MAX_TOTAL_HEIGHT) throw new RangeError("Virtual list exceeds maximum total height");
    this.measured.clear();
    this.heights.fill(this.estimateHeight);
    this.total = total;
    this.rebuild();
  }
  keyAt(index) {
    return this.keys[index];
  }
  indexOf(key) {
    return this.indices.get(key) ?? -1;
  }
  heightAt(index) {
    return this.heights[index] ?? 0;
  }
  measure(index, height) {
    heightValue(height);
    if (!Number.isInteger(index) || index < 0 || index >= this.count) throw new RangeError("Invalid virtual row index");
    const delta = height - this.heights[index];
    if (this.total + delta > MAX_TOTAL_HEIGHT) throw new RangeError("Virtual list exceeds maximum total height");
    this.measured.set(this.keys[index], { item: this.values[index], height });
    if (!delta) return false;
    this.heights[index] = height;
    this.total += delta;
    for (let next = index + 1; next <= this.count; next += next & -next) this.tree[next] += delta;
    return true;
  }
  offsetAt(index) {
    if (!Number.isInteger(index) || index < 0 || index > this.count) throw new RangeError("Invalid virtual row index");
    let sum = 0;
    for (let next = index; next > 0; next -= next & -next) sum += this.tree[next];
    return sum;
  }
  indexAt(offset) {
    if (!Number.isFinite(offset)) throw new RangeError("Virtual offset must be finite");
    if (!this.count) return -1;
    const target = Math.max(0, offset);
    let index = 0;
    let sum = 0;
    for (let step = 2 ** Math.floor(Math.log2(this.count)); step >= 1; step = Math.floor(step / 2)) {
      const next = index + step;
      if (next <= this.count && sum + this.tree[next] <= target) {
        index = next;
        sum += this.tree[next];
      }
    }
    return Math.min(index, this.count - 1);
  }
  range(scrollTop, viewportHeight, overscan = 3) {
    if (![scrollTop, viewportHeight, overscan].every(Number.isFinite) || viewportHeight < 0 || overscan < 0) {
      throw new RangeError("Virtual viewport and overscan must be finite and nonnegative");
    }
    if (!this.count || viewportHeight === 0) return { start: 0, end: 0 };
    const top = Math.max(0, scrollTop);
    return {
      start: this.indexAt(Math.max(0, top - overscan)),
      end: Math.min(this.count, this.indexAt(Math.max(0, top + viewportHeight + overscan - 1)) + 1)
    };
  }
  anchor(scrollTop) {
    const index = this.indexAt(scrollTop);
    return index < 0 ? void 0 : { key: this.keys[index], index, offset: Math.max(0, scrollTop - this.offsetAt(index)) };
  }
  resolveAnchor(anchor) {
    if (!anchor || !this.count) return 0;
    const found = this.indexOf(anchor.key);
    const index = found < 0 ? Math.min(anchor.index, this.count - 1) : found;
    return this.offsetAt(index) + Math.min(anchor.offset, this.heightAt(index) - 1);
  }
};

// src/renderables/VirtualList.ts
function contains(root, target) {
  for (let node = target; node; node = node.parent instanceof Renderable ? node.parent : null) {
    if (node === root) return true;
  }
  return false;
}
var VirtualListRenderable = class extends ScrollBoxRenderable {
  model;
  renderItem;
  overscan;
  rows = /* @__PURE__ */ new Map();
  lastWidth = -1;
  lastTotal = -1;
  scheduled = false;
  refreshing = false;
  anchor;
  seek;
  constructor(context, options) {
    const { items, getKey, renderItem, estimateHeight, overscan = 3, ...scrollOptions } = options;
    const model = new VirtualListModel(getKey, estimateHeight);
    model.setItems(items);
    if (!Number.isSafeInteger(overscan) || overscan < 0 || overscan > 1e4) {
      throw new RangeError("Virtual list overscan must be an integer from 0 to 10000");
    }
    super(context, { ...scrollOptions, scrollX: false, contentOptions: { height: model.totalHeight, minHeight: 0 } });
    this.model = model;
    this.renderItem = renderItem;
    this.overscan = overscan;
    this.viewport.on("resize", this.schedule);
    this._ctx.on("focused_renderable", this.schedule);
    this.schedule();
  }
  get items() {
    return this.model.items;
  }
  set items(items) {
    this.setItems(items);
  }
  get mountedCount() {
    return this.rows.size;
  }
  get totalHeight() {
    return this.model.totalHeight;
  }
  setItems(items) {
    if (this.isDestroyed) return;
    const anchor = this.anchor ?? this.model.anchor(this.scrollTop);
    this.model.setItems(items);
    this.anchor = anchor;
    this.schedule();
  }
  /** Uses estimates until the target is measured; alignment settles with native layout. */
  scrollToIndex(index, align = "start") {
    if (this.isDestroyed) return;
    if (!Number.isInteger(index) || index < 0 || index >= this.model.count) throw new RangeError("Invalid virtual row index");
    if (!["start", "center", "end"].includes(align)) throw new TypeError("Invalid virtual row alignment");
    this.seek = { key: this.model.keyAt(index), align };
    this.anchor = void 0;
    this.refresh();
    this.schedule();
  }
  schedule = () => {
    if (this.scheduled || this.isDestroyed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.isDestroyed) return;
      if (this.refresh()) this.requestRender();
    });
  };
  onUpdate(deltaTime) {
    super.onUpdate(deltaTime);
    this.schedule();
  }
  drop(key, row) {
    this.rows.delete(key);
    if (contains(row.box, this._ctx.currentFocusedRenderable)) this.focus();
    row.box.destroyRecursively();
  }
  refresh() {
    if (this.refreshing || this.isDestroyed || !this.model) return false;
    this.refreshing = true;
    let dirty = false;
    try {
      if (this.seek?.offset !== void 0 && this.scrollTop !== this.seek.offset) this.seek = void 0;
      const width = this.viewport.width;
      const viewport = this.viewport.height;
      const anchor = this.anchor ?? this.model.anchor(this.scrollTop);
      let changed = !!this.anchor;
      this.anchor = void 0;
      if (width !== this.lastWidth) {
        this.lastWidth = width;
        this.model.resetMeasurements();
        for (const row of this.rows.values()) row.measured = false;
        changed = true;
      } else {
        for (const [key, row] of this.rows) {
          const index = this.model.indexOf(key);
          if (row.measured && index >= 0 && Object.is(this.model.items[index], row.item)) {
            changed = this.model.measure(index, Math.max(1, Math.ceil(row.box.height))) || changed;
          }
        }
      }
      if (this.lastTotal !== this.model.totalHeight) {
        this.lastTotal = this.model.totalHeight;
        this.content.height = this.model.totalHeight;
        dirty = true;
      }
      this.verticalScrollBar.scrollSize = this.model.totalHeight;
      this.verticalScrollBar.viewportSize = viewport;
      let offset = changed ? this.model.resolveAnchor(anchor) : this.scrollTop;
      if (this.seek) {
        const index = this.model.indexOf(this.seek.key);
        if (index >= 0) {
          const extra = viewport - this.model.heightAt(index);
          offset = this.model.offsetAt(index) - (this.seek.align === "center" ? Math.floor(extra / 2) : this.seek.align === "end" ? extra : 0);
          if (this.rows.get(this.seek.key)?.measured && !changed) this.seek = void 0;
        } else this.seek = void 0;
      }
      const nextTop = Math.max(0, Math.min(offset, Math.max(0, this.model.totalHeight - viewport)));
      if (this.scrollTop !== nextTop) {
        this.scrollTop = nextTop;
        dirty = true;
      }
      if (this.seek) this.seek.offset = this.scrollTop;
      const range = this.model.range(this.scrollTop, viewport, this.overscan);
      for (const [key, row] of this.rows) {
        const index = this.model.indexOf(key);
        const obsolete = index < 0 || index !== row.index || !Object.is(row.item, this.model.items[index]);
        const outside = index < range.start || index >= range.end;
        if (obsolete || outside && !contains(row.box, this._ctx.currentFocusedRenderable)) {
          this.drop(key, row);
          dirty = true;
        }
      }
      for (let index = range.start; index < range.end; index++) {
        const key = this.model.keyAt(index);
        if (this.rows.has(key)) continue;
        const item = this.model.items[index];
        const content = this.renderItem(item, index, this._ctx);
        if (content.isDestroyed || content.parent || content.ctx !== this._ctx) {
          throw new Error("Virtual rows must be unattached live renderables belonging to this renderer");
        }
        const box = new BoxRenderable(this._ctx, {
          id: `${this.id}-virtual-${index}`,
          position: "absolute",
          left: 0,
          top: this.model.offsetAt(index),
          width,
          flexDirection: "column",
          flexShrink: 0
        });
        const row = { item, index, box, measured: false };
        box.add(content);
        box.on("resize", () => {
          row.measured = true;
          this.schedule();
        });
        this.content.add(box);
        this.rows.set(key, row);
        dirty = true;
        box.renderAfter = () => {
          if (!row.measured) {
            row.measured = true;
            this.schedule();
          }
        };
      }
      for (const [key, row] of this.rows) {
        const top = this.model.offsetAt(this.model.indexOf(key));
        if (row.box.top !== top) {
          row.box.top = top;
          dirty = true;
        }
        if (row.box.width !== width) {
          row.box.width = width;
          dirty = true;
        }
      }
    } finally {
      this.refreshing = false;
    }
    return dirty;
  }
  destroySelf() {
    this.viewport.off("resize", this.schedule);
    this._ctx.off("focused_renderable", this.schedule);
    for (const [key, row] of this.rows) this.drop(key, row);
    super.destroySelf();
  }
};

// src/lib/keymap-help.ts
import stripAnsi from "strip-ansi";
var keyLabels = /* @__PURE__ */ new Map([
  ["enter", "Enter"],
  ["return", "Enter"],
  ["esc", "Esc"],
  ["escape", "Esc"],
  ["space", "Space"],
  [" ", "Space"],
  ["plus", "Plus"],
  ["tab", "Tab"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["insert", "Insert"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
  ["up", "Up"],
  ["down", "Down"],
  ["left", "Left"],
  ["right", "Right"]
]);
var modifierOrder = /* @__PURE__ */ new Map([["ctrl", 0], ["shift", 1], ["alt", 2], ["meta", 2], ["super", 3], ["hyper", 4]]);
function plainLine(value) {
  return stripAnsi(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/ +/g, " ").trim();
}
function searchable(value) {
  return plainLine(value).replace(/\s+/gu, " ").normalize("NFC").toLowerCase();
}
function formatKeymapKeys(keys) {
  const sequence = typeof keys === "string" ? [keys] : keys;
  return sequence.map((chord) => {
    const parts = chord.toLowerCase().split("+");
    const key = parts.pop();
    const modifiers = parts.sort((a, b) => (modifierOrder.get(a) ?? 5) - (modifierOrder.get(b) ?? 5)).map((part) => {
      switch (part) {
        case "ctrl":
          return "Ctrl";
        case "shift":
          return "Shift";
        case "alt":
        case "meta":
          return "Alt";
        case "super":
          return "Super";
        case "hyper":
          return "Hyper";
        default:
          return plainLine(part);
      }
    });
    const label = keyLabels.get(key) ?? (/^f\d+$/.test(key) ? key.toUpperCase() : plainLine(key));
    return [...modifiers, label].join("+");
  }).join(" ");
}
function createKeymapHelpEntries(bindings, query = "") {
  const needle = searchable(query);
  const entries = [];
  for (const binding of bindings) {
    const id = plainLine(binding.id);
    const description = plainLine(binding.description ?? "") || id;
    const shortcut = formatKeymapKeys(binding.keys);
    const haystack = `${id} ${description} ${shortcut} ${binding.keys.join(" ")}`;
    if (!needle || searchable(haystack).includes(needle)) entries.push({ id, shortcut, description });
  }
  return entries;
}

// src/renderables/KeymapHelp.ts
function snapshot(bindings) {
  return bindings.map(({ id, keys, description }) => ({ id, keys: [...keys], description }));
}
function helpContent(entries, emptyText) {
  return entries.length ? entries.map((entry) => `${entry.shortcut}  ${entry.description}`).join("\n") : emptyText;
}
var KeymapHelpRenderable = class extends TextRenderable {
  _bindings;
  _query;
  _emptyText;
  _matchCount;
  constructor(context, options = {}) {
    const { bindings = [], query = "", emptyText = "No matching shortcuts.", ...textOptions } = options;
    const copied = snapshot(bindings);
    const entries = createKeymapHelpEntries(copied, query);
    super(context, { ...textOptions, content: helpContent(entries, emptyText) });
    this._bindings = copied;
    this._query = query;
    this._emptyText = emptyText;
    this._matchCount = entries.length;
  }
  get bindings() {
    return snapshot(this._bindings);
  }
  set bindings(value) {
    if (this.isDestroyed) return;
    const next = snapshot(value ?? []);
    const entries = createKeymapHelpEntries(next, this._query);
    this._bindings = next;
    this.updateHelp(entries);
  }
  get query() {
    return this._query;
  }
  set query(value) {
    if (this.isDestroyed) return;
    const next = value ?? "";
    const entries = createKeymapHelpEntries(this._bindings, next);
    this._query = next;
    this.updateHelp(entries);
  }
  get emptyText() {
    return this._emptyText;
  }
  set emptyText(value) {
    if (this.isDestroyed) return;
    this._emptyText = value ?? "No matching shortcuts.";
    if (!this._matchCount) this.content = this._emptyText;
  }
  get matchCount() {
    return this._matchCount;
  }
  updateHelp(entries) {
    this._matchCount = entries.length;
    this.content = helpContent(entries, this._emptyText);
  }
};

// src/lib/image.ts
import { inflateSync } from "node:zlib";
var MAX_IMAGE_PIXELS = 4194304;
var MAX_PNG_BYTES = 16 * 1024 * 1024;
function validateImageDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_IMAGE_PIXELS) throw new RangeError("Image dimensions exceed the 4194304 pixel budget");
}
function copyRgbaImage(image) {
  validateImageDimensions(image.width, image.height);
  if (!(image.data instanceof Uint8Array) || image.data.byteLength !== image.width * image.height * 4) {
    throw new RangeError("RGBA image data must contain exactly four bytes per pixel");
  }
  return Object.freeze({ width: image.width, height: image.height, data: new Uint8Array(image.data) });
}
var signature = [137, 80, 78, 71, 13, 10, 26, 10];
var crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 4294967295;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
function paeth(left, above, corner) {
  const prediction = left + above - corner;
  const a = Math.abs(prediction - left), b = Math.abs(prediction - above), c = Math.abs(prediction - corner);
  return a <= b && a <= c ? left : b <= c ? above : corner;
}
function decodePng(bytes) {
  if (bytes.byteLength > MAX_PNG_BYTES) throw new RangeError("PNG exceeds the 16 MiB encoded byte budget");
  if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) throw new Error("Invalid PNG signature");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, color = -1, channels = 0;
  let palette;
  let transparency;
  const chunks = [];
  let compressedLength = 0;
  let sawData = false, dataEnded = false, ended = false;
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("Truncated PNG chunk");
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Truncated PNG chunk data");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || bytes[offset + 6] & 32) throw new Error("Invalid PNG chunk type");
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error("Invalid PNG chunk CRC");
    const data = bytes.subarray(offset + 8, end - 4);
    if (offset === 8 && type !== "IHDR") throw new Error("PNG header must be first");
    if (sawData && type !== "IDAT") dataEnded = true;
    switch (type) {
      case "IHDR": {
        if (width || length !== 13) throw new Error("Invalid or repeated PNG header");
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
        validateImageDimensions(width, height);
        color = data[9];
        channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color] ?? 0;
        if (data[8] !== 8 || !channels || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
          throw new Error("Only noninterlaced 8-bit PNG images are supported");
        }
        break;
      }
      case "PLTE":
        if (palette || sawData || color === 0 || color === 4 || !length || length > 768 || length % 3) {
          throw new Error("Invalid PNG palette");
        }
        palette = data;
        break;
      case "tRNS":
        if (transparency || sawData || (color === 0 ? length !== 2 : color === 2 ? length !== 6 : color === 3 ? !palette || !length || length > palette.length / 3 : true)) throw new Error("Invalid PNG transparency");
        transparency = data;
        break;
      case "IDAT":
        if (dataEnded || color === 3 && !palette) throw new Error("Invalid PNG image data order");
        if (chunks.length >= 4096) throw new Error("PNG exceeds the image data chunk budget");
        sawData = true;
        compressedLength += length;
        chunks.push(data);
        break;
      case "IEND":
        if (length || !sawData || end !== bytes.length) throw new Error("Invalid PNG end chunk");
        ended = true;
        break;
      default:
        if (!(bytes[offset + 4] & 32)) throw new Error(`Unsupported critical PNG chunk: ${type}`);
    }
    offset = end;
    if (ended) break;
  }
  if (!ended || !compressedLength) throw new Error("Incomplete PNG image");
  const compressed = new Uint8Array(compressedLength);
  let cursor = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, cursor);
    cursor += chunk.length;
  }
  const stride = width * channels;
  const expectedLength = (stride + 1) * height;
  const inflated = inflateSync(compressed, { maxOutputLength: expectedLength });
  if (inflated.length !== expectedLength) throw new Error("Invalid PNG decoded size");
  const pixels = new Uint8Array(width * height * 4);
  const transparent = transparency ? new DataView(transparency.buffer, transparency.byteOffset, transparency.length) : null;
  let previous = new Uint8Array(stride);
  let row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = inflated[start];
    if (filter > 4) throw new Error("Invalid PNG row filter");
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = previous[x], corner = x >= channels ? previous[x - channels] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, corner);
      row[x] = inflated[start + 1 + x] + prediction & 255;
    }
    for (let x = 0; x < width; x++) {
      const source = x * channels, dest = (y * width + x) * 4;
      const red2 = row[source], green2 = row[source + 1], blue2 = row[source + 2];
      if (color === 3) {
        if (!palette || red2 * 3 + 2 >= palette.length) throw new Error("PNG palette index out of range");
        pixels[dest] = palette[red2 * 3];
        pixels[dest + 1] = palette[red2 * 3 + 1];
        pixels[dest + 2] = palette[red2 * 3 + 2];
        pixels[dest + 3] = transparency?.[red2] ?? 255;
      } else {
        pixels[dest] = red2;
        pixels[dest + 1] = color === 0 || color === 4 ? red2 : green2;
        pixels[dest + 2] = color === 0 || color === 4 ? red2 : blue2;
        let alpha = color === 4 ? green2 : color === 6 ? row[source + 3] : 255;
        if (transparent) {
          if (color === 0 ? red2 === transparent.getUint16(0) : red2 === transparent.getUint16(0) && green2 === transparent.getUint16(2) && blue2 === transparent.getUint16(4)) {
            alpha = 0;
          }
        }
        pixels[dest + 3] = alpha;
      }
    }
    const scratch = previous;
    previous = row;
    row = scratch;
  }
  return Object.freeze({ width, height, data: pixels });
}

// src/lib/kitty-image.ts
import { randomInt } from "node:crypto";
import { deflateSync } from "node:zlib";

// src/lib/kitty-diacritics.ts
var KITTY_DIACRITICS = Object.freeze([
  773,
  781,
  782,
  784,
  786,
  829,
  830,
  831,
  838,
  842,
  843,
  844,
  848,
  849,
  850,
  855,
  859,
  867,
  868,
  869,
  870,
  871,
  872,
  873,
  874,
  875,
  876,
  877,
  878,
  879,
  1155,
  1156,
  1157,
  1158,
  1159,
  1426,
  1427,
  1428,
  1429,
  1431,
  1432,
  1433,
  1436,
  1437,
  1438,
  1439,
  1440,
  1441,
  1448,
  1449,
  1451,
  1452,
  1455,
  1476,
  1552,
  1553,
  1554,
  1555,
  1556,
  1557,
  1558,
  1559,
  1623,
  1624,
  1625,
  1626,
  1627,
  1629,
  1630,
  1750,
  1751,
  1752,
  1753,
  1754,
  1755,
  1756,
  1759,
  1760,
  1761,
  1762,
  1764,
  1767,
  1768,
  1771,
  1772,
  1840,
  1842,
  1843,
  1845,
  1846,
  1850,
  1853,
  1855,
  1856,
  1857,
  1859,
  1861,
  1863,
  1865,
  1866,
  2027,
  2028,
  2029,
  2030,
  2031,
  2032,
  2033,
  2035,
  2070,
  2071,
  2072,
  2073,
  2075,
  2076,
  2077,
  2078,
  2079,
  2080,
  2081,
  2082,
  2083,
  2085,
  2086,
  2087,
  2089,
  2090,
  2091,
  2092,
  2093,
  2385,
  2387,
  2388,
  3970,
  3971,
  3974,
  3975,
  4957,
  4958,
  4959,
  6109,
  6458,
  6679,
  6773,
  6774,
  6775,
  6776,
  6777,
  6778,
  6779,
  6780,
  7019,
  7021,
  7022,
  7023,
  7024,
  7025,
  7026,
  7027,
  7376,
  7377,
  7378,
  7386,
  7387,
  7392,
  7616,
  7617,
  7619,
  7620,
  7621,
  7622,
  7623,
  7624,
  7625,
  7627,
  7628,
  7633,
  7634,
  7635,
  7636,
  7637,
  7638,
  7639,
  7640,
  7641,
  7642,
  7643,
  7644,
  7645,
  7646,
  7647,
  7648,
  7649,
  7650,
  7651,
  7652,
  7653,
  7654,
  7678,
  8400,
  8401,
  8404,
  8405,
  8406,
  8407,
  8411,
  8412,
  8417,
  8423,
  8425,
  8432,
  11503,
  11504,
  11505,
  11744,
  11745,
  11746,
  11747,
  11748,
  11749,
  11750,
  11751,
  11752,
  11753,
  11754,
  11755,
  11756,
  11757,
  11758,
  11759,
  11760,
  11761,
  11762,
  11763,
  11764,
  11765,
  11766,
  11767,
  11768,
  11769,
  11770,
  11771,
  11772,
  11773,
  11774,
  11775,
  42607,
  42620,
  42621,
  42736,
  42737,
  43232,
  43233,
  43234,
  43235,
  43236,
  43237,
  43238,
  43239,
  43240,
  43241,
  43242,
  43243,
  43244,
  43245,
  43246,
  43247,
  43248,
  43249,
  43696,
  43698,
  43699,
  43703,
  43704,
  43710,
  43711,
  43713,
  65056,
  65057,
  65058,
  65059,
  65060,
  65061,
  65062,
  68111,
  68152,
  119173,
  119174,
  119175,
  119176,
  119177,
  119210,
  119211,
  119212,
  119213,
  119362,
  119363,
  119364
].map((value) => String.fromCodePoint(value)));

// src/lib/kitty-image.ts
var KITTY_PLACEHOLDER = "\u{10EEEE}";
var MAX_KITTY_CELLS = KITTY_DIACRITICS.length;
var sessions = /* @__PURE__ */ new WeakMap();
var allocatedIds = /* @__PURE__ */ new Set();
var encoder = new TextEncoder();
function supportsKittyPlaceholders(capabilities, explicit = false) {
  if (!capabilities?.kitty_graphics || !capabilities.rgb || capabilities.multiplexer !== "none") return false;
  if (explicit) return true;
  const version = /^(\d+)\.(\d+)/.exec(capabilities.terminal.version);
  return capabilities.terminal.name.toLowerCase() === "kitty" && !!version && (Number(version[1]) > 0 || Number(version[2]) >= 28);
}
function kittyPlaceholder(id, row, column) {
  if (!Number.isInteger(id) || id < 1 || id > 4294967295 || !Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0 || row >= MAX_KITTY_CELLS || column >= MAX_KITTY_CELLS) {
    throw new RangeError("Invalid Kitty placeholder coordinates or image ID");
  }
  return KITTY_PLACEHOLDER + KITTY_DIACRITICS[row] + KITTY_DIACRITICS[column] + KITTY_DIACRITICS[id >>> 24];
}
function encodeKittyImage(image, id, columns, rows) {
  kittyPlaceholder(id, rows - 1, columns - 1);
  const payload = deflateSync(image.data, { level: 3 }).toString("base64");
  const sequences = [];
  for (let offset = 0; offset < payload.length; offset += 4096) {
    const more = offset + 4096 < payload.length ? 1 : 0;
    const controls = offset === 0 ? `a=t,f=32,o=z,t=d,s=${image.width},v=${image.height},i=${id},q=2,m=${more}` : `m=${more}`;
    sequences.push(`\x1B_G${controls};${payload.slice(offset, offset + 4096)}\x1B\\`);
  }
  sequences.push(`\x1B_Ga=p,U=1,i=${id},c=${columns},r=${rows},q=2\x1B\\`);
  return encoder.encode(sequences.join(""));
}
var KittyImageSession = class _KittyImageSession {
  constructor(context) {
    this.context = context;
    context.on("frame", this.flushRetired);
    context.on("capabilities", this.invalidate);
    context.once("destroy", this.dispose);
  }
  context;
  ids = /* @__PURE__ */ new Set();
  retired = /* @__PURE__ */ new Set();
  disposed = false;
  invalidate = () => {
    this.context.requestRender();
  };
  static forContext(context) {
    let session = sessions.get(context);
    if (!session) {
      session = new _KittyImageSession(context);
      sessions.set(context, session);
    }
    return session;
  }
  allocate() {
    if (this.disposed || this.ids.size >= 256) return null;
    let id;
    do {
      id = randomInt(1, 4294967296);
    } while (allocatedIds.has(id));
    allocatedIds.add(id);
    this.ids.add(id);
    return id;
  }
  retire(id) {
    if (this.disposed || !this.ids.has(id)) return;
    this.retired.add(id);
    this.context.requestRender();
  }
  flushRetired = () => {
    for (const id of [...this.retired]) {
      if (!this.context.queueTerminalControl?.(encoder.encode(`\x1B_Ga=d,d=I,i=${id},q=2\x1B\\`))) break;
      this.retired.delete(id);
      this.ids.delete(id);
      allocatedIds.delete(id);
    }
  };
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.ids) {
      this.context.queueTerminalControl?.(encoder.encode(`\x1B_Ga=d,d=I,i=${id},q=2\x1B\\`));
      allocatedIds.delete(id);
    }
    this.ids.clear();
    this.retired.clear();
    this.context.off("frame", this.flushRetired);
    this.context.off("capabilities", this.invalidate);
    this.context.off("destroy", this.dispose);
    sessions.delete(this.context);
  };
};

// src/renderables/Image.ts
var MAX_ALT_LENGTH = 1024;
var ImageRenderable = class extends Renderable {
  _source;
  pixels = null;
  controller;
  loadGeneration = 0;
  placement = null;
  _alt;
  _fit;
  _protocol;
  _cellAspectRatio;
  _backgroundColor;
  kittySession;
  onLoad;
  onError;
  loadPromise = Promise.resolve();
  loadError = null;
  constructor(context, options = {}) {
    const fit = options.fit ?? "contain", protocol = options.protocol ?? "auto";
    const aspect = options.cellAspectRatio ?? 2;
    if (!["contain", "cover", "fill"].includes(fit) || !["auto", "kitty", "blocks"].includes(protocol) || !Number.isFinite(aspect) || aspect <= 0 || aspect > 100) throw new RangeError("Invalid image display options");
    super(context, { width: 40, height: 12, ...options, buffered: true });
    this._alt = this.cleanAlt(options.alt ?? "Image unavailable");
    this._fit = fit;
    this._protocol = protocol;
    this._cellAspectRatio = aspect;
    this._backgroundColor = RGBA.clone(parseColor(options.backgroundColor ?? "black"));
    this.onLoad = options.onLoad;
    this.onError = options.onError;
    this.kittySession = KittyImageSession.forContext(context);
    if (options.source !== void 0) this.source = options.source;
  }
  cleanAlt(text) {
    const cleaned = stripAnsiSequences(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
    if (cleaned.length <= MAX_ALT_LENGTH) return cleaned;
    let end = MAX_ALT_LENGTH;
    const code = cleaned.charCodeAt(end - 1);
    if (code >= 55296 && code <= 56319) end--;
    return cleaned.slice(0, end);
  }
  get source() {
    return this._source;
  }
  set source(source) {
    if (this.isDestroyed) return;
    const generation = ++this.loadGeneration;
    const previous = this.controller;
    this.controller = void 0;
    previous?.abort();
    if (this.isDestroyed || this.loadGeneration !== generation) return;
    this._source = source;
    this.pixels = null;
    this.loadError = null;
    this.retirePlacement();
    this.requestRender();
    if (source === void 0) {
      this.loadPromise = Promise.resolve();
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    let snapshot2;
    let snapshotError;
    try {
      if (source instanceof Uint8Array && source.length > MAX_PNG_BYTES) {
        throw new RangeError("PNG exceeds the 16 MiB encoded byte budget");
      }
      snapshot2 = typeof source === "function" ? void 0 : source instanceof Uint8Array ? new Uint8Array(source) : copyRgbaImage(source);
    } catch (error) {
      snapshotError = error;
    }
    this.loadPromise = (async () => {
      await Promise.resolve();
      try {
        if (controller.signal.aborted || this.isDestroyed || this.controller !== controller) return;
        if (snapshotError) throw snapshotError;
        const value = typeof source === "function" ? await source(controller.signal) : snapshot2;
        if (controller.signal.aborted || this.isDestroyed || this.controller !== controller) return;
        this.pixels = value instanceof Uint8Array ? decodePng(value) : copyRgbaImage(value);
        this.requestRender();
        this.onLoad?.();
      } catch (error) {
        if (controller.signal.aborted || this.isDestroyed || this.controller !== controller) return;
        this.pixels = null;
        this.loadError = error;
        this.requestRender();
        this.onError?.(error);
        throw error;
      } finally {
        if (this.controller === controller) this.controller = void 0;
      }
    })();
    void this.loadPromise.catch(() => {
    });
  }
  get alt() {
    return this._alt;
  }
  set alt(value) {
    if (!this.isDestroyed) {
      this._alt = this.cleanAlt(value);
      this.requestRender();
    }
  }
  get fit() {
    return this._fit;
  }
  set fit(value) {
    if (!["contain", "cover", "fill"].includes(value)) throw new RangeError("Invalid image fit");
    if (!this.isDestroyed && value !== this._fit) {
      this._fit = value;
      this.retirePlacement();
      this.requestRender();
    }
  }
  get protocol() {
    return this._protocol;
  }
  set protocol(value) {
    if (!["auto", "kitty", "blocks"].includes(value)) throw new RangeError("Invalid image protocol");
    if (!this.isDestroyed && value !== this._protocol) {
      this._protocol = value;
      this.retirePlacement();
      this.requestRender();
    }
  }
  get cellAspectRatio() {
    return this._cellAspectRatio;
  }
  set cellAspectRatio(value) {
    if (!Number.isFinite(value) || value <= 0 || value > 100) throw new RangeError("Invalid image cell aspect ratio");
    if (!this.isDestroyed) {
      this._cellAspectRatio = value;
      this.retirePlacement();
      this.requestRender();
    }
  }
  get backgroundColor() {
    return RGBA.clone(this._backgroundColor);
  }
  set backgroundColor(value) {
    if (!this.isDestroyed) {
      this._backgroundColor = RGBA.clone(parseColor(value));
      this.requestRender();
    }
  }
  get effectiveProtocol() {
    if (this._protocol === "blocks" || this._fit !== "contain" || !this._ctx.queueTerminalControl || this._ctx.allowKittyImages === false || this.width > MAX_KITTY_CELLS || this.height > MAX_KITTY_CELLS || !supportsKittyPlaceholders(this._ctx.capabilities, this._protocol === "kitty")) return "blocks";
    for (let node = this; node; node = node.parent instanceof Renderable ? node.parent : null) {
      if (node.opacity !== 1) return "blocks";
    }
    return "kitty";
  }
  retirePlacement() {
    if (!this.placement) return;
    this.kittySession.retire(this.placement.id);
    this.placement = null;
  }
  renderSelf(buffer) {
    buffer.clear(this._backgroundColor);
    const image = this.pixels;
    if (!image) {
      buffer.drawText(this._alt, 0, 0, RGBA.fromInts(180, 180, 180), this._backgroundColor);
      return;
    }
    const scale = this._fit === "fill" ? 0 : (this._fit === "contain" ? Math.min : Math.max)(
      this.width / image.width,
      this.height * this._cellAspectRatio / image.height
    );
    const width = this._fit === "fill" ? this.width : Math.max(1, Math.round(image.width * scale));
    const height = this._fit === "fill" ? this.height : Math.max(
      1,
      Math.round(image.height * scale / this._cellAspectRatio)
    );
    const left = Math.floor((this.width - width) / 2), top = Math.floor((this.height - height) / 2);
    if (this.effectiveProtocol === "kitty" && width <= MAX_KITTY_CELLS && height <= MAX_KITTY_CELLS) {
      const epoch = this._ctx.terminalControlEpoch ?? 0;
      if (this.placement && (this.placement.width !== width || this.placement.height !== height || this.placement.epoch !== epoch)) this.retirePlacement();
      if (!this.placement) {
        const id = this.kittySession.allocate();
        if (id !== null) this.placement = { id, width, height, epoch, bytes: encodeKittyImage(image, id, width, height) };
      }
      const placement = this.placement;
      if (placement && (!placement.bytes || this._ctx.queueTerminalControl(placement.bytes))) {
        placement.bytes = null;
        const color = RGBA.fromInts(placement.id >>> 16 & 255, placement.id >>> 8 & 255, placement.id & 255);
        for (let y = 0; y < height; y++) {
          let row = "";
          for (let x = 0; x < width; x++) row += kittyPlaceholder(placement.id, y, x);
          buffer.drawText(row, left, top + y, color, this._backgroundColor);
        }
        return;
      }
      if (placement) this.requestRender();
    } else {
      this.retirePlacement();
    }
    const background = this._backgroundColor.toInts();
    const sample = (x, y) => {
      const sx = Math.min(image.width - 1, Math.max(0, Math.floor(x * image.width / width)));
      const sy = Math.min(image.height - 1, Math.max(0, Math.floor(y * image.height / (height * 2))));
      const offset = (sy * image.width + sx) * 4;
      const alpha = image.data[offset + 3] / 255;
      return RGBA.fromInts(
        image.data[offset] * alpha + background[0] * (1 - alpha),
        image.data[offset + 1] * alpha + background[1] * (1 - alpha),
        image.data[offset + 2] * alpha + background[2] * (1 - alpha)
      );
    };
    for (let y = Math.max(0, top); y < Math.min(this.height, top + height); y++) {
      for (let x = Math.max(0, left); x < Math.min(this.width, left + width); x++) {
        const upper = sample(x - left, (y - top) * 2), lower = sample(x - left, (y - top) * 2 + 1);
        buffer.setCell(x, y, "\u2580", upper, lower);
      }
    }
  }
  destroySelf() {
    this.loadGeneration++;
    const controller = this.controller;
    this.controller = void 0;
    controller?.abort();
    this.retirePlacement();
    this.pixels = null;
    this._source = void 0;
    super.destroySelf();
  }
};

// src/lib/autocomplete.ts
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
function validOffset(text, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 55296 && before <= 56319 && after >= 56320 && after <= 57343);
}
function validateRequest(request) {
  if (!validOffset(request.text, request.cursor)) throw new RangeError("Invalid autocomplete cursor");
}
function sameRequest(a, b) {
  return a.text === b.text && a.cursor === b.cursor;
}
function applyAutocomplete(request, result, item) {
  validateRequest(request);
  if (!sameRequest(request, result.request) || !result.items.includes(item)) return null;
  if (!validOffset(request.text, result.start) || !validOffset(request.text, result.end) || result.start > request.cursor || result.end < request.cursor) {
    throw new RangeError("Invalid autocomplete replacement range");
  }
  const cursorOffset = item.cursorOffset ?? item.insertText.length;
  if (!validOffset(item.insertText, cursorOffset)) throw new RangeError("Invalid autocomplete item cursor");
  return {
    text: request.text.slice(0, result.start) + item.insertText + request.text.slice(result.end),
    cursor: result.start + cursorOffset
  };
}
var AutocompleteController = class {
  constructor(provider) {
    this.provider = provider;
  }
  provider;
  pending;
  disposed = false;
  async request(request) {
    if (this.disposed) return null;
    validateRequest(request);
    const snapshot2 = Object.freeze({ ...request });
    const previous = this.pending;
    const pending = new AbortController();
    this.pending = pending;
    previous?.abort();
    if (this.disposed || pending.signal.aborted || this.pending !== pending) return null;
    try {
      const result = await this.provider(snapshot2, pending.signal);
      if (pending.signal.aborted || this.pending !== pending) return null;
      if (result && !sameRequest(snapshot2, result.request)) {
        throw new Error("Autocomplete provider returned a stale result");
      }
      return result;
    } catch (error) {
      if (pending.signal.aborted) return null;
      throw error;
    } finally {
      if (this.pending === pending) this.pending = void 0;
    }
  }
  cancel() {
    const pending = this.pending;
    this.pending = void 0;
    pending?.abort();
  }
  dispose() {
    this.disposed = true;
    this.cancel();
  }
};
function createSlashCommandProvider(commands) {
  const entries = commands.map((command) => {
    if (!command.name || /[\s/]/u.test(command.name)) {
      throw new Error("Slash command names must be single bare tokens");
    }
    return { ...command };
  });
  return (request, signal) => {
    validateRequest(request);
    if (signal.aborted || request.cursor === 0 || !request.text.startsWith("/")) return null;
    const end = request.text.search(/\s/u);
    const tokenEnd = end < 0 ? request.text.length : end;
    if (request.cursor > tokenEnd) return null;
    const prefix = request.text.slice(1, request.cursor).toLowerCase();
    const items = entries.filter((command) => command.name.toLowerCase().startsWith(prefix)).map((command) => ({
      label: `/${command.name}`,
      insertText: `/${command.name}`,
      description: command.description
    }));
    return { request: { ...request }, start: 0, end: tokenEnd, items };
  };
}
function createFilePathProvider(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const home = options.home ?? homedir();
  const limit = options.maxResults ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("maxResults must be a positive integer");
  return async (request, signal) => {
    validateRequest(request);
    if (signal.aborted) return null;
    const tokens = /@?"[^"\r\n]*(?:"|$)|[^\s"]+/gu;
    let match;
    let token;
    while (match = tokens.exec(request.text)) {
      const end = match.index + match[0].length;
      if (match.index <= request.cursor && request.cursor <= end) {
        token = { text: match[0], start: match.index, end };
        break;
      }
    }
    if (!token) return null;
    const mention = token.text.startsWith("@") ? "@" : "";
    const quoted = token.text[mention.length] === '"';
    const contentStart = token.start + mention.length + Number(quoted);
    const contentEnd = token.end - Number(quoted && token.text.endsWith('"') && token.end > contentStart);
    if (request.cursor < contentStart) return null;
    const prefix = request.text.slice(contentStart, Math.min(request.cursor, contentEnd));
    if (!prefix && !mention && !quoted) return null;
    const separator = process.platform === "win32" ? /[\\/]/u : /\//u;
    let slash = -1;
    for (let index = 0; index < prefix.length; index++) if (separator.test(prefix[index])) slash = index;
    const directory = prefix.slice(0, slash + 1);
    const name = prefix.slice(slash + 1);
    const expanded = directory.startsWith("~/") || directory.startsWith("~\\") ? path.join(home, directory.slice(2)) : directory;
    let entries;
    try {
      entries = await readdir(path.resolve(cwd, expanded || "."), { withFileTypes: true });
    } catch (error) {
      const code = error.code ?? "";
      if (signal.aborted || ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(code)) {
        return null;
      }
      throw error;
    }
    if (signal.aborted) return null;
    const matches2 = entries.filter((entry) => entry.name.startsWith(name)).filter((entry) => options.includeHidden || name.startsWith(".") || !entry.name.startsWith(".")).filter((entry) => !/["\x00-\x1f\x7f-\x9f]/u.test(entry.name)).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)).slice(0, limit);
    const items = await Promise.all(
      matches2.map(async (entry) => {
        let isDirectory = entry.isDirectory();
        if (entry.isSymbolicLink() && !signal.aborted) {
          try {
            isDirectory = (await stat(path.resolve(cwd, expanded || ".", entry.name))).isDirectory();
          } catch {
          }
        }
        const suffix = isDirectory ? directory.endsWith("\\") ? "\\" : "/" : "";
        const value = directory + entry.name + suffix;
        const needsQuotes = quoted || /\s/u.test(value);
        const insertText = needsQuotes ? `${mention}"${value}"` : mention + value;
        return {
          label: entry.name + suffix,
          insertText,
          cursorOffset: needsQuotes && isDirectory ? insertText.length - 1 : insertText.length,
          description: isDirectory ? "Directory" : entry.isSymbolicLink() ? "Symbolic link" : "File"
        };
      })
    );
    if (signal.aborted) return null;
    items.sort(
      (a, b) => Number(b.description === "Directory") - Number(a.description === "Directory") || a.label.localeCompare(b.label)
    );
    return { request: { ...request }, start: token.start, end: token.end, items };
  };
}
function combineAutocompleteProviders(...providers) {
  return async (request, signal) => {
    for (const provider of providers) {
      if (signal.aborted) return null;
      const result = await provider(request, signal);
      if (signal.aborted) return null;
      if (result) return result;
    }
    return null;
  };
}

// src/lib/editor-autocomplete.ts
function getEditorAutocompleteRequest(editor) {
  return { text: editor.plainText, cursor: editor.editBuffer.getTextRange(0, editor.cursorOffset).length };
}
function applyEditorAutocomplete(editor, result, item) {
  if (editor.isDestroyed || editor.hasSelection()) return false;
  const replacement = applyAutocomplete(getEditorAutocompleteRequest(editor), result, item);
  if (!replacement) return false;
  const prefix = replacement.text.slice(0, replacement.cursor);
  const measurement = TextBuffer.create(editor.ctx.widthMethod);
  try {
    measurement.setText(editor instanceof InputRenderable ? prefix.replace(/[\n\r]/g, "") : prefix);
    editor.replaceText(replacement.text, measurement.length + measurement.getLineCount() - 1);
  } finally {
    measurement.destroy();
  }
  return true;
}

// src/lib/overlay.ts
function contains2(parent, child) {
  for (let node = child; node; node = node.parent instanceof Renderable ? node.parent : null) {
    if (node === parent) return true;
  }
  return false;
}
function dimension(value, available) {
  const cells = typeof value === "number" ? value : available * Number(value.slice(0, -1)) / 100;
  if (!Number.isFinite(cells) || cells < 0 || typeof value === "string" && !/^\d+(?:\.\d+)?%$/u.test(value)) throw new RangeError("Invalid overlay size");
  return Math.min(available, Math.floor(cells));
}
var OverlayManager = class _OverlayManager {
  constructor(renderer) {
    this.renderer = renderer;
    if (renderer.isDestroyed) throw new Error("Cannot create overlays on a destroyed renderer");
    renderer.on("resize", this.resize);
    renderer.on("focused_renderable", this.trackFocus);
    renderer.once("destroy", this.dispose);
  }
  renderer;
  entries = [];
  disposed = false;
  disposing = false;
  serial = 0;
  static forRenderer(renderer) {
    let manager = managers.get(renderer);
    if (!manager) {
      manager = new _OverlayManager(renderer);
      managers.set(renderer, manager);
    }
    return manager;
  }
  show(content, options = {}) {
    if (this.disposed || this.disposing || this.renderer.isDestroyed) throw new Error("Overlay manager is disposed");
    if (content.isDestroyed || content.parent || content.ctx !== this.renderer) {
      throw new Error("Overlay content must be an unattached live renderable belonging to this renderer");
    }
    const target = options.focus ?? (content.focusable ? content : void 0);
    if (target && (!contains2(content, target) || target.isDestroyed || !target.focusable)) {
      throw new Error("Overlay focus target must be a live focusable descendant of its content");
    }
    for (const value of [options.margin ?? 0, options.offsetX ?? 0, options.offsetY ?? 0]) {
      if (!Number.isSafeInteger(value)) throw new RangeError("Overlay offsets and margin must be finite integers");
    }
    if ((options.margin ?? 0) < 0) throw new RangeError("Overlay margin cannot be negative");
    const anchors = [
      "center",
      "top-left",
      "top-center",
      "top-right",
      "left-center",
      "right-center",
      "bottom-left",
      "bottom-center",
      "bottom-right"
    ];
    if (options.anchor !== void 0 && !anchors.includes(options.anchor)) throw new Error("Invalid overlay anchor");
    dimension(options.width ?? 60, this.renderer.width);
    dimension(options.height ?? 10, this.renderer.height);
    const visible = options.visible?.(this.renderer.width, this.renderer.height) ?? true;
    const container = new BoxRenderable(this.renderer, {
      id: `ax-tui-overlay-${++this.serial}`,
      position: "absolute",
      overflow: "hidden",
      flexShrink: 0,
      visible
    });
    const entry = {
      container,
      content,
      target,
      previous: this.renderer.currentFocusedRenderable,
      options: { ...options },
      hidden: false,
      removed: false,
      lastBlurred: null,
      onDestroyed: () => this.remove(entry)
    };
    container.add(content);
    this.renderer.root.add(container);
    this.entries.push(entry);
    content.once("destroyed" /* DESTROYED */, entry.onDestroyed);
    container.once("destroyed" /* DESTROYED */, entry.onDestroyed);
    if (target && target !== content) target.once("destroyed" /* DESTROYED */, entry.onDestroyed);
    try {
      this.layout(entry, visible);
      this.order();
      if (!options.nonCapturing && visible) this.focus(entry);
    } catch (error) {
      try {
        this.remove(entry);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Overlay creation failed");
      }
      throw error;
    }
    return {
      close: () => this.remove(entry),
      setHidden: (hidden) => {
        if (entry.removed || hidden === entry.hidden) return;
        entry.hidden = hidden;
        this.layout(entry);
      },
      isHidden: () => entry.removed || !entry.container.visible,
      focus: () => this.focus(entry),
      isFocused: () => !entry.removed && contains2(entry.container, this.renderer.currentFocusedRenderable)
    };
  }
  eligible(target) {
    if (!target || target.isDestroyed || !target.focusable) return false;
    for (let node = target; node; node = node.parent instanceof Renderable ? node.parent : null) {
      if (node.isDestroyed || !node.visible) return false;
      if (node === this.renderer.root) return true;
    }
    return false;
  }
  focus(entry) {
    if (entry.removed || !entry.container.visible || !this.eligible(entry.target)) return;
    const current = this.renderer.currentFocusedRenderable;
    if (!contains2(entry.container, current)) {
      for (const candidate of this.entries) {
        if (candidate !== entry && contains2(entry.container, candidate.previous)) candidate.previous = entry.previous;
      }
      entry.previous = current;
    }
    this.entries = this.entries.filter((candidate) => candidate !== entry);
    this.entries.push(entry);
    this.order();
    entry.target.focus();
  }
  restore(entry) {
    if (this.disposed || this.renderer.isDestroyed) return;
    const current = this.renderer.currentFocusedRenderable;
    const destroyedFocus = !current && entry.lastBlurred?.isDestroyed;
    if (!contains2(entry.container, current) && !destroyedFocus) return;
    current?.blur();
    const redirected = this.renderer.currentFocusedRenderable;
    if (this.renderer.isDestroyed || redirected && !contains2(entry.container, redirected)) return;
    let previous = entry.previous;
    const visited = /* @__PURE__ */ new Set();
    while (previous && !this.eligible(previous) && !visited.has(previous)) {
      visited.add(previous);
      previous = this.entries.find((candidate) => contains2(candidate.container, previous))?.previous ?? null;
    }
    if (this.eligible(previous)) {
      previous.focus();
      return;
    }
    for (const candidate of [...this.entries].reverse()) {
      if (candidate !== entry && !candidate.options.nonCapturing && this.eligible(candidate.target)) {
        candidate.target.focus();
        return;
      }
    }
  }
  layout(entry, visible) {
    const { width, height } = this.renderer;
    const options = entry.options;
    const show = !entry.hidden && (visible ?? options.visible?.(width, height) ?? true);
    if (entry.removed) return;
    try {
      if (!show) this.restore(entry);
    } finally {
      if (!entry.removed) entry.container.visible = show;
    }
    if (entry.removed) return;
    const marginX = Math.min(options.margin ?? 0, Math.floor(width / 2));
    const marginY = Math.min(options.margin ?? 0, Math.floor(height / 2));
    const availableWidth = Math.max(0, width - marginX * 2);
    const availableHeight = Math.max(0, height - marginY * 2);
    const w = dimension(options.width ?? 60, availableWidth);
    const h2 = dimension(options.height ?? 10, availableHeight);
    const anchor = options.anchor ?? "center";
    const x = anchor.includes("left") ? 0 : anchor.includes("right") ? availableWidth - w : (availableWidth - w) / 2;
    const y = anchor.includes("top") ? 0 : anchor.includes("bottom") ? availableHeight - h2 : (availableHeight - h2) / 2;
    entry.container.width = w;
    entry.container.height = h2;
    entry.container.left = marginX + Math.max(0, Math.min(availableWidth - w, Math.floor(x) + (options.offsetX ?? 0)));
    entry.container.top = marginY + Math.max(0, Math.min(availableHeight - h2, Math.floor(y) + (options.offsetY ?? 0)));
  }
  order() {
    const own = new Set(this.entries.map((entry) => entry.container));
    const base = Math.max(0, ...this.renderer.root.getChildren().filter((child) => !own.has(child)).map((child) => child instanceof Renderable ? child.zIndex : 0));
    this.entries.forEach((entry, index) => {
      entry.container.zIndex = base + index + 1;
    });
  }
  remove(entry) {
    if (entry.removed) return;
    entry.removed = true;
    this.entries = this.entries.filter((candidate) => candidate !== entry);
    for (const candidate of this.entries) {
      if (contains2(entry.container, candidate.previous)) candidate.previous = entry.previous;
    }
    try {
      this.restore(entry);
    } finally {
      entry.content.off("destroyed" /* DESTROYED */, entry.onDestroyed);
      entry.container.off("destroyed" /* DESTROYED */, entry.onDestroyed);
      entry.target?.off("destroyed" /* DESTROYED */, entry.onDestroyed);
      try {
        if (!entry.container.isDestroyed) entry.container.destroyRecursively();
      } finally {
        this.order();
      }
    }
  }
  resize = () => {
    const errors = [];
    for (const entry of [...this.entries]) {
      if (entry.removed) continue;
      try {
        this.layout(entry);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "Overlay resize failed");
  };
  trackFocus = (current, previous) => {
    for (const entry of this.entries) {
      entry.lastBlurred = !current && contains2(entry.container, previous) ? previous : null;
    }
  };
  /** Destroy all owned overlays and remove renderer listeners. Safe during renderer teardown. */
  dispose = () => {
    if (this.disposed || this.disposing) return;
    this.disposing = true;
    const errors = [];
    try {
      for (const entry of [...this.entries].reverse()) {
        try {
          this.remove(entry);
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      this.disposed = true;
      this.disposing = false;
      this.renderer.off("resize", this.resize);
      this.renderer.off("focused_renderable", this.trackFocus);
      this.renderer.off("destroy", this.dispose);
      managers.delete(this.renderer);
    }
    if (errors.length) throw new AggregateError(errors, "Overlay disposal failed");
  };
};
var managers = /* @__PURE__ */ new WeakMap();
function getOverlayManager(renderer) {
  return OverlayManager.forRenderer(renderer);
}

// src/lib/keymap.ts
var managers2 = /* @__PURE__ */ new WeakMap();
var aliases = { enter: "return", esc: "escape", space: " ", plus: "+" };
function parseChord(value) {
  const parts = value.toLowerCase().split("+");
  const key = parts.pop();
  if (!key || parts.some((part) => !["ctrl", "shift", "alt", "meta", "super", "hyper"].includes(part))) {
    throw new TypeError(`Invalid keymap chord: ${value}`);
  }
  if (new Set(parts.map((part) => part === "alt" ? "meta" : part)).size !== parts.length) {
    throw new TypeError(`Duplicate keymap modifier: ${value}`);
  }
  return {
    name: aliases[key] ?? key,
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    meta: parts.includes("meta") || parts.includes("alt"),
    super: parts.includes("super"),
    hyper: parts.includes("hyper")
  };
}
function matches(chord, event) {
  return chord.name === (aliases[event.name.toLowerCase()] ?? event.name.toLowerCase()) && chord.ctrl === !!event.ctrl && chord.shift === !!event.shift && chord.meta === !!event.meta && chord.super === !!event.super && chord.hyper === !!event.hyper;
}
var Keymap = class _Keymap {
  constructor(renderer, sequenceTimeoutMs) {
    this.renderer = renderer;
    this.sequenceTimeoutMs = sequenceTimeoutMs;
    renderer.keyInput.on("keypress", this.dispatch);
    renderer.keyInput.on("paste", this.cancelSequence);
    renderer.on("focused_renderable", this.cancelSequence);
    renderer.on("blur", this.cancelSequence);
    renderer.once("destroy", this.dispose);
  }
  renderer;
  sequenceTimeoutMs;
  layers = [];
  serial = 0;
  disposed = false;
  pending;
  timer;
  static forRenderer(renderer, options = {}) {
    if (renderer.isDestroyed) throw new Error("Cannot create a keymap on a destroyed renderer");
    const timeout = options.sequenceTimeoutMs ?? 750;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 6e4) {
      throw new RangeError("Keymap sequence timeout must be an integer from 1 to 60000");
    }
    const existing = managers2.get(renderer);
    if (existing) {
      if (options.sequenceTimeoutMs !== void 0 && timeout !== existing.sequenceTimeoutMs) {
        throw new Error("This renderer already has a keymap with a different sequence timeout");
      }
      return existing;
    }
    const keymap = new _Keymap(renderer, timeout);
    managers2.set(renderer, keymap);
    return keymap;
  }
  register(options) {
    if (this.disposed) throw new Error("Keymap is disposed");
    if (options.target && (options.target.isDestroyed || options.target.ctx !== this.renderer)) {
      throw new Error("Keymap target must be a live renderable belonging to this renderer");
    }
    if (!Number.isFinite(options.priority ?? 0)) throw new RangeError("Keymap priority must be finite");
    if (options.scope !== void 0 && !["focus", "focus-within"].includes(options.scope)) {
      throw new TypeError("Invalid keymap scope");
    }
    const ids = /* @__PURE__ */ new Set();
    const sequences = /* @__PURE__ */ new Set();
    const bindings = options.bindings.map((binding) => {
      const keys = typeof binding.keys === "string" ? [binding.keys] : [...binding.keys];
      if (!binding.id || ids.has(binding.id) || !keys.length || keys.length > 16) {
        throw new TypeError("Keymap bindings need unique nonempty IDs and 1 to 16 chords");
      }
      const chords = keys.map(parseChord);
      const signature2 = JSON.stringify(chords);
      if (sequences.has(signature2)) throw new TypeError("Duplicate keymap sequence in one layer");
      ids.add(binding.id);
      sequences.add(signature2);
      return {
        info: {
          id: binding.id,
          keys,
          description: binding.description,
          priority: options.priority ?? 0,
          target: options.target
        },
        chords,
        handler: binding.handler
      };
    });
    const layer = { options: { ...options }, bindings, serial: ++this.serial, remove: () => {
    } };
    layer.remove = () => {
      this.layers = this.layers.filter((item) => item !== layer);
      layer.options.target?.off("destroyed" /* DESTROYED */, layer.remove);
      if (this.pending?.layer === layer) this.cancelSequence();
    };
    options.target?.once("destroyed" /* DESTROYED */, layer.remove);
    this.layers.push(layer);
    this.cancelSequence();
    return layer.remove;
  }
  distance(layer) {
    if (!this.layers.includes(layer)) return -1;
    let enabled = true;
    try {
      enabled = layer.options.enabled?.() !== false;
    } catch {
      enabled = false;
    }
    if (!enabled) return -1;
    if (this.disposed || !this.layers.includes(layer)) return -1;
    const target = layer.options.target;
    if (!target) return Number.MAX_SAFE_INTEGER;
    let attached2 = false;
    for (let node = target; node; node = node.parent instanceof Renderable ? node.parent : null) {
      if (node.isDestroyed || !node.visible) return -1;
      if (node === this.renderer.root) {
        attached2 = true;
        break;
      }
    }
    if (!attached2) return -1;
    let distance = 0;
    for (let node = this.renderer.currentFocusedRenderable; node; node = node.parent instanceof Renderable ? node.parent : null) {
      if (node === target) return distance;
      if (layer.options.scope === "focus") break;
      distance++;
    }
    return -1;
  }
  activeLayers() {
    return [...this.layers].map((layer) => ({ layer, distance: this.distance(layer) })).filter(({ distance }) => distance >= 0).sort((a, b) => (b.layer.options.priority ?? 0) - (a.layer.options.priority ?? 0) || a.distance - b.distance || b.layer.serial - a.layer.serial).map(({ layer }) => layer);
  }
  /** Eligible bindings, in dispatch order. Includes bindings shadowed by earlier layers. */
  getActiveBindings() {
    return this.activeLayers().flatMap((layer) => layer.bindings.map(({ info }) => ({ ...info, keys: [...info.keys] })));
  }
  get pendingKeys() {
    return this.pending?.bindings[0]?.info.keys.slice(0, this.pending.index) ?? [];
  }
  cancelSequence = () => {
    clearTimeout(this.timer);
    this.timer = void 0;
    this.pending = void 0;
  };
  invoke(layer, binding, event) {
    this.cancelSequence();
    if (!this.disposed && this.distance(layer) >= 0) binding.handler(event);
  }
  accept(layer, bindings, index, event) {
    event.preventDefault();
    event.stopPropagation();
    this.cancelSequence();
    const exact = bindings.find((binding) => binding.chords.length === index);
    if (bindings.every((binding) => binding.chords.length === index)) {
      if (exact) this.invoke(layer, exact, event);
      return;
    }
    this.pending = { layer, bindings, index, event };
    this.timer = setTimeout(() => {
      this.cancelSequence();
      if (exact) {
        try {
          this.invoke(layer, exact, event);
        } catch (error) {
          console.error("[Keymap] Sequence handler failed:", error);
        }
      }
    }, this.sequenceTimeoutMs);
    this.timer.unref?.();
  }
  dispatch = (event) => {
    if (this.disposed || event.defaultPrevented || event.propagationStopped || event.eventType === "release") return;
    const pending = this.pending;
    if (pending) {
      if (event.name === "escape") {
        this.cancelSequence();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.repeated) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const next = this.distance(pending.layer) < 0 ? [] : pending.bindings.filter((binding) => {
        const chord = binding.chords[pending.index];
        return chord && matches(chord, event);
      });
      if (next.length) {
        this.accept(pending.layer, next, pending.index + 1, event);
        return;
      }
      this.cancelSequence();
    }
    for (const layer of this.activeLayers()) {
      const matchesFirst = layer.bindings.filter((binding) => matches(binding.chords[0], event));
      if (!matchesFirst.length || this.distance(layer) < 0) continue;
      this.accept(layer, matchesFirst, 1, event);
      return;
    }
  };
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelSequence();
    for (const layer of [...this.layers]) layer.remove();
    this.renderer.keyInput.off("keypress", this.dispatch);
    this.renderer.keyInput.off("paste", this.cancelSequence);
    this.renderer.off("focused_renderable", this.cancelSequence);
    this.renderer.off("blur", this.cancelSequence);
    this.renderer.off("destroy", this.dispose);
    managers2.delete(this.renderer);
  };
};
function getKeymap(renderer, options) {
  return Keymap.forRenderer(renderer, options);
}

// src/lib/focus.ts
var managers3 = /* @__PURE__ */ new WeakMap();
function contains3(root, node) {
  for (; node; node = node.parent instanceof Renderable ? node.parent : null) {
    if (node === root) return true;
  }
  return false;
}
var FocusManager = class _FocusManager {
  constructor(renderer) {
    this.renderer = renderer;
    getKeymap(renderer);
    renderer.keyInput.on("keypress", this.dispatch);
    renderer.once("destroy", this.dispose);
  }
  renderer;
  scopes = [];
  disposed = false;
  moving = false;
  serial = 0;
  static forRenderer(renderer) {
    if (renderer.isDestroyed) throw new Error("Cannot navigate focus on a destroyed renderer");
    let manager = managers3.get(renderer);
    if (!manager) {
      manager = new _FocusManager(renderer);
      managers3.set(renderer, manager);
    }
    return manager;
  }
  registerScope(root, options = {}) {
    if (this.disposed || root.isDestroyed || root.ctx !== this.renderer) {
      throw new Error("Focus scope must belong to this live renderer");
    }
    const order = [...options.order ?? []];
    if (new Set(order).size !== order.length || order.some((node) => !contains3(root, node))) {
      throw new Error("Focus order must contain unique descendants of the scope");
    }
    const scope = { root, options: { ...options, order }, serial: ++this.serial, remove: () => {
    } };
    scope.remove = () => {
      this.scopes = this.scopes.filter((candidate) => candidate !== scope);
      root.off("destroyed" /* DESTROYED */, scope.remove);
    };
    this.scopes.push(scope);
    root.once("destroyed" /* DESTROYED */, scope.remove);
    return scope.remove;
  }
  attached(node) {
    for (let ancestor = node; ancestor; ancestor = ancestor.parent instanceof Renderable ? ancestor.parent : null) {
      if (ancestor.isDestroyed || !ancestor.visible) return false;
      if (ancestor === this.renderer.root) return true;
    }
    return false;
  }
  candidates(scope) {
    const nodes = [];
    const visit = (node) => {
      if (node.isDestroyed || !node.visible) return;
      if (node.focusable) nodes.push(node);
      for (const child of node.getChildren()) visit(child);
    };
    visit(scope.root);
    const order = new Map(scope.options.order?.map((node, index) => [node, index]));
    return nodes.sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
  }
  focusNext() {
    return this.move(1);
  }
  focusPrevious() {
    return this.move(-1);
  }
  move(direction) {
    if (this.disposed || this.moving || this.renderer.isDestroyed) return false;
    this.moving = true;
    try {
      const initialFocus = this.renderer.currentFocusedRenderable;
      const active = [...this.scopes].filter((scope) => {
        let enabled = true;
        try {
          enabled = scope.options.enabled?.() !== false;
        } catch {
          enabled = false;
        }
        return enabled && !this.disposed && this.scopes.includes(scope) && this.attached(scope.root);
      });
      if (this.disposed || this.renderer.currentFocusedRenderable !== initialFocus) return false;
      const current = this.renderer.currentFocusedRenderable;
      const depth = (scope) => {
        let count = 0;
        for (let node = scope.root.parent; node; node = node.parent) count++;
        return count;
      };
      const modal = active.filter((scope) => scope.options.modal).sort((a, b) => depth(b) - depth(a) || b.serial - a.serial)[0];
      const scopes = modal ? [modal] : active.filter((scope) => !current || contains3(scope.root, current)).sort((a, b) => depth(b) - depth(a) || b.serial - a.serial);
      for (const scope of scopes) {
        if (!this.scopes.includes(scope) || !this.attached(scope.root)) continue;
        const nodes = this.candidates(scope);
        if (!nodes.length) {
          if (scope.options.modal) return true;
          continue;
        }
        const index = current ? nodes.indexOf(current) : -1;
        let next = index < 0 ? direction === 1 ? 0 : nodes.length - 1 : index + direction;
        const wraps = scope.options.modal || scope.root === this.renderer.root;
        if (next < 0 || next >= nodes.length) {
          if (!wraps) continue;
          next = (next + nodes.length) % nodes.length;
        }
        const target = nodes[next];
        if (target === current) return !!scope.options.modal;
        if (!this.scopes.includes(scope) || !this.attached(target) || !target.focusable) continue;
        target.focus();
        return this.renderer.currentFocusedRenderable !== current;
      }
      return false;
    } finally {
      this.moving = false;
    }
  }
  dispatch = (event) => {
    if (event.defaultPrevented || event.propagationStopped || event.eventType === "release" || event.name !== "tab" || event.ctrl || event.meta || event.super || event.hyper) return;
    if (event.shift ? this.focusPrevious() : this.focusNext()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    for (const scope of [...this.scopes]) scope.remove();
    this.renderer.keyInput.off("keypress", this.dispatch);
    this.renderer.off("destroy", this.dispose);
    managers3.delete(this.renderer);
  };
};
function getFocusManager(renderer) {
  return FocusManager.forRenderer(renderer);
}

// src/lib/commands.ts
import { EventEmitter as EventEmitter2 } from "node:events";
var registries = /* @__PURE__ */ new WeakMap();
function plainLine2(value) {
  return stripAnsiSequences(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").trim();
}
function attached(renderer, node) {
  for (let ancestor = node; ancestor; ancestor = ancestor.parent instanceof Renderable ? ancestor.parent : null) {
    if (ancestor.isDestroyed || !ancestor.visible) return false;
    if (ancestor === renderer.root) return true;
  }
  return false;
}
function captureCommandContext(renderer) {
  return Object.freeze({ renderer, focused: renderer.currentFocusedRenderable });
}
var CommandRegistry = class _CommandRegistry extends EventEmitter2 {
  constructor(renderer) {
    super();
    this.renderer = renderer;
    renderer.once("destroy", this.dispose);
  }
  renderer;
  commands = /* @__PURE__ */ new Map();
  disposed = false;
  static forRenderer(renderer) {
    if (renderer.isDestroyed) throw new Error("Cannot register commands on a destroyed renderer");
    let registry = registries.get(renderer);
    if (!registry) {
      registry = new _CommandRegistry(renderer);
      registries.set(renderer, registry);
    }
    return registry;
  }
  register(command, target) {
    if (this.disposed || this.renderer.isDestroyed) throw new Error("Command registry is disposed");
    if (!command.id || command.id !== plainLine2(command.id) || !plainLine2(command.title) || typeof command.run !== "function" || this.commands.has(command.id)) {
      throw new Error("Commands require a unique nonempty ID, title and handler");
    }
    if (target && (target.isDestroyed || target.ctx !== this.renderer)) {
      throw new Error("Command target must belong to this live renderer");
    }
    const definition = {
      ...command,
      title: plainLine2(command.title),
      description: plainLine2(command.description ?? ""),
      keywords: command.keywords?.map(plainLine2)
    };
    const registration = { definition, target, remove: () => {
    } };
    registration.remove = () => {
      if (this.commands.get(definition.id) !== registration) return;
      this.commands.delete(definition.id);
      target?.off("destroyed" /* DESTROYED */, registration.remove);
      this.emit("change");
    };
    this.commands.set(command.id, registration);
    target?.once("destroyed" /* DESTROYED */, registration.remove);
    this.emit("change");
    return registration.remove;
  }
  validContext(context) {
    return context.renderer === this.renderer && !this.renderer.isDestroyed && (!context.focused || attached(this.renderer, context.focused));
  }
  enabled(registration, context) {
    if (registration.target && !attached(this.renderer, registration.target)) return false;
    const enabled = registration.definition.enabled?.(context) !== false;
    return enabled && !this.disposed && this.validContext(context) && this.commands.get(registration.definition.id) === registration && (!registration.target || attached(this.renderer, registration.target));
  }
  search(query = "", context = captureCommandContext(this.renderer)) {
    if (this.disposed || !this.validContext(context)) return [];
    const needle = Array.from(plainLine2(query).normalize("NFKC").toLowerCase()).slice(0, 256);
    const entries = [];
    for (const registration of [...this.commands.values()]) {
      const { definition } = registration;
      let enabled = false;
      try {
        enabled = this.enabled(registration, context);
      } catch {
      }
      if (this.disposed || this.commands.get(definition.id) !== registration) continue;
      const haystack = Array.from([
        definition.title,
        definition.id,
        definition.description,
        ...definition.keywords ?? []
      ].join(" ").normalize("NFKC").toLowerCase());
      let cursor = 0;
      let score = 0;
      let matches2 = true;
      for (const character of needle) {
        const found = haystack.indexOf(character, cursor);
        if (found < 0) {
          matches2 = false;
          break;
        }
        score += found - cursor;
        cursor = found + 1;
      }
      if (!matches2) continue;
      const metadata = Object.freeze({
        id: definition.id,
        title: definition.title,
        description: definition.description ?? "",
        keywords: Object.freeze([...definition.keywords ?? []]),
        enabled
      });
      entries.push({ metadata, score, index: entries.length });
    }
    return Object.freeze(entries.sort((a, b) => a.score - b.score || a.index - b.index).map(({ metadata }) => metadata));
  }
  async execute(id, context = captureCommandContext(this.renderer)) {
    if (this.disposed) return { status: "disposed" };
    if (!this.validContext(context)) return { status: "stale-context" };
    const registration = this.commands.get(id);
    if (!registration) return { status: "not-found" };
    try {
      if (!this.enabled(registration, context)) return { status: "disabled" };
      await registration.definition.run(context);
      return { status: "executed" };
    } catch (error) {
      return { status: "error", error };
    }
  }
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    for (const registration of [...this.commands.values()]) registration.remove();
    this.renderer.off("destroy", this.dispose);
    registries.delete(this.renderer);
    this.removeAllListeners();
  };
};
function getCommandRegistry(renderer) {
  return CommandRegistry.forRenderer(renderer);
}

// src/lib/command-palette.ts
function showCommandPalette(renderer, options = {}) {
  const registry = options.registry ?? getCommandRegistry(renderer);
  if (registry.renderer !== renderer || renderer.isDestroyed) {
    throw new Error("Command palette requires a registry belonging to this live renderer");
  }
  const context = captureCommandContext(renderer);
  const content = new BoxRenderable(renderer, {
    width: "100%",
    height: "100%",
    flexDirection: "column",
    border: true,
    backgroundColor: "#161b22"
  });
  let input;
  let list;
  let empty;
  let overlay;
  let removeKeys = () => {
  };
  let removeScope = () => {
  };
  let closed = false;
  let executing = false;
  let settled = false;
  let refreshing = false;
  let entries = [];
  let selectedId = null;
  const completion = Promise.withResolvers();
  const finish = (result) => {
    if (settled) return;
    settled = true;
    completion.resolve(result);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    registry.off("change", refresh);
    removeKeys();
    removeScope();
    input?.off("input" /* INPUT */, refresh);
    content.off("destroyed" /* DESTROYED */, close);
    input?.off("destroyed" /* DESTROYED */, close);
    try {
      overlay?.close();
    } finally {
      content.destroyRecursively();
      if (!executing) finish(null);
    }
  };
  function refresh() {
    if (closed || refreshing) return;
    refreshing = true;
    try {
      entries = registry.search(input.value, context);
      if (closed || content.isDestroyed) return;
      if (!entries.some((entry) => entry.id === selectedId)) selectedId = entries[0]?.id ?? null;
      const rows = entries.map((command) => ({ command, selected: command.id === selectedId }));
      list.items = rows;
      empty.visible = rows.length === 0;
      list.visible = rows.length > 0;
      const index = entries.findIndex((entry) => entry.id === selectedId);
      if (index >= 0) list.scrollToIndex(index);
    } finally {
      refreshing = false;
    }
  }
  const select = (direction) => {
    if (closed || !entries.length) return;
    const index = entries.findIndex((entry) => entry.id === selectedId);
    selectedId = entries[(index + direction + entries.length) % entries.length].id;
    refresh();
  };
  const executeSelected = async () => {
    if (closed || executing || !selectedId) return null;
    const id = selectedId;
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry?.enabled) return { status: "disabled" };
    executing = true;
    try {
      close();
      const result = await registry.execute(id, context);
      finish(result);
      return result;
    } catch (error) {
      const result = { status: "error", error };
      finish(result);
      return result;
    }
  };
  try {
    input = new InputRenderable(renderer, {
      width: "100%",
      value: options.query ?? "",
      maxLength: 256,
      placeholder: options.placeholder ?? "Search commands..."
    });
    content.add(input);
    list = new VirtualListRenderable(renderer, {
      width: "100%",
      flexGrow: 1,
      minHeight: 0,
      items: [],
      getKey: (row) => row.command.id,
      estimateHeight: 1,
      renderItem: (row, _index, ctx) => new TextRenderable(ctx, {
        height: 1,
        width: "100%",
        wrapMode: "none",
        content: `${row.selected ? ">" : " "} ${row.command.title}${row.command.enabled ? "" : " (unavailable)"}`,
        fg: row.command.enabled ? "#ffffff" : "#8b949e",
        bg: row.selected ? "#264f78" : "transparent",
        onMouseDown() {
          if (!closed) {
            selectedId = row.command.id;
            refresh();
          }
        }
      })
    });
    content.add(list);
    empty = new TextRenderable(renderer, { height: 1, content: options.emptyText ?? "No matching commands." });
    content.add(empty);
    content.once("destroyed" /* DESTROYED */, close);
    input.once("destroyed" /* DESTROYED */, close);
    input.on("input" /* INPUT */, refresh);
    registry.on("change", refresh);
    overlay = getOverlayManager(renderer).show(content, {
      width: 64,
      height: 12,
      margin: 1,
      ...options.overlay,
      focus: input
    });
    removeScope = getFocusManager(renderer).registerScope(content, { modal: true });
    removeKeys = getKeymap(renderer).register({ target: content, priority: 1e3, bindings: [
      { id: "palette.next", keys: "down", handler: () => select(1) },
      { id: "palette.previous", keys: "up", handler: () => select(-1) },
      { id: "palette.execute", keys: "enter", handler: () => {
        void executeSelected();
      } },
      { id: "palette.close", keys: "escape", handler: close }
    ] });
    refresh();
  } catch (error) {
    close();
    throw error;
  }
  return {
    input,
    get selectedId() {
      return selectedId;
    },
    result: completion.promise,
    setQuery(query) {
      if (!closed) input.value = query;
    },
    refresh,
    executeSelected,
    close
  };
}
export {
  ACHROMATOPSIA_MATRIX,
  ASCIIFont,
  ASCIIFontRenderable,
  ASCIIFontSelectionHelper,
  ATTRIBUTE_BASE_BITS,
  ATTRIBUTE_BASE_MASK,
  ArrowRenderable,
  Audio,
  AutocompleteController,
  BaseRenderable,
  BloomEffect,
  BorderCharArrays,
  BorderChars,
  Box,
  BoxRenderable,
  CRTRollingBarEffect,
  CliRenderEvents,
  CliRenderer,
  CloudsEffect,
  Code,
  CodeRenderable,
  CommandRegistry,
  ConsolePosition,
  DEFAULT_BACKGROUND_RGB,
  DEFAULT_FOREGROUND_RGB,
  DEUTERANOPIA_COMP_MATRIX,
  DEUTERANOPIA_SIM_MATRIX,
  DataPathsManager,
  DebugOverlayCorner,
  DiffRenderable,
  DistortionEffect,
  EditBuffer,
  EditBufferRenderable,
  EditBufferRenderableEvents,
  EditorView,
  ExtmarksController,
  FlamesEffect,
  FocusManager,
  FrameBuffer,
  FrameBufferRenderable,
  GRAYSCALE_MATRIX,
  GREENSCALE_MATRIX,
  Generic,
  INVERT_MATRIX,
  ImageRenderable,
  Input,
  InputRenderable,
  InputRenderableEvents,
  InternalKeyHandler,
  KeyEvent,
  KeyHandler,
  Keymap,
  KeymapHelpRenderable,
  LayoutEvents,
  LineNumberRenderable,
  LinearScrollAccel,
  LogLevel,
  MAX_IMAGE_PIXELS,
  MAX_PNG_BYTES,
  MacOSScrollAccel,
  MarkdownRenderable,
  MouseButton,
  MouseEvent,
  MouseParser,
  NativeSpanFeed,
  OptimizedBuffer,
  OverlayManager,
  PROTANOPIA_COMP_MATRIX,
  PROTANOPIA_SIM_MATRIX,
  PasteEvent,
  RGBA,
  RainbowTextEffect,
  Renderable,
  RenderableEvents,
  RendererControlState,
  RootRenderable,
  RootTextNodeRenderable,
  SEPIA_MATRIX,
  SOLARIZATION_MATRIX,
  SYNTHWAVE_MATRIX,
  ScrollBarRenderable,
  ScrollBox,
  ScrollBoxRenderable,
  Select,
  SelectRenderable,
  SelectRenderableEvents,
  Selection,
  SliderRenderable,
  SlotRegistry,
  SlotRenderable,
  StdinParser,
  StyledText,
  SyntaxStyle,
  SystemClock,
  TECHNICOLOR_MATRIX,
  TRITANOPIA_COMP_MATRIX,
  TRITANOPIA_SIM_MATRIX,
  TabSelect,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TargetChannel,
  TerminalConsole,
  TerminalPalette,
  Text,
  TextAttributes,
  TextBuffer,
  TextBufferRenderable,
  TextBufferView,
  TextNodeRenderable,
  TextRenderable,
  TextTableRenderable,
  TextareaRenderable,
  TimeToFirstDrawRenderable,
  Timeline,
  TreeSitterClient,
  VRenderable,
  VignetteEffect,
  VirtualListModel,
  VirtualListRenderable,
  yoga_exports as Yoga,
  addDefaultParsers,
  ansi256IndexToRgb,
  applyAsciiArt,
  applyAutocomplete,
  applyBrightness,
  applyChromaticAberration,
  applyEditorAutocomplete,
  applyGain,
  applyInvert,
  applyNoise,
  applySaturation,
  applyScanlines,
  attributesWithLink,
  basenameToFiletype,
  bg,
  bgBlack,
  bgBlue,
  bgCyan,
  bgGreen,
  bgMagenta,
  bgRed,
  bgWhite,
  bgYellow,
  black,
  blink,
  blue,
  bold,
  borderCharsToArray,
  brightBlack,
  brightBlue,
  brightCyan,
  brightGreen,
  brightMagenta,
  brightRed,
  brightWhite,
  brightYellow,
  buildKittyKeyboardFlags,
  buildTerminalPaletteSignature,
  capture,
  captureCommandContext,
  clearEnvCache,
  combineAutocompleteProviders,
  convertGlobalToLocalSelection,
  convertThemeToStyles,
  coordinateToCharacterIndex,
  copyRgbaImage,
  createCliRenderer,
  createCoreSlotRegistry,
  createExtmarksController,
  createFilePathProvider,
  createKeymapHelpEntries,
  createMarkdownCodeBlockRenderer,
  createSlashCommandProvider,
  createSlotRegistry,
  createTerminalPalette,
  createTextAttributes,
  createTimeline,
  cyan,
  decodePasteBytes,
  decodePng,
  defaultTextareaKeyBindings,
  delegate,
  destroyTreeSitterClient,
  detectLinks,
  dim,
  engine,
  env,
  envRegistry,
  extToFiletype,
  extensionToFiletype,
  fg,
  fonts,
  formatKeymapKeys,
  generateEnvColored,
  generateEnvMarkdown,
  getBaseAttributes,
  getBorderFromSides,
  getBorderSides,
  getCharacterPositions,
  getCommandRegistry,
  getDataPaths,
  getEditorAutocompleteRequest,
  getFocusManager,
  getKeymap,
  getLinkId,
  getOverlayManager,
  getTreeSitterClient,
  green,
  h,
  hastToStyledText,
  hexToRgb,
  hsvToRgb,
  infoStringToFiletype,
  instantiate,
  isEditBufferRenderable,
  isRenderable,
  isStyledText,
  isTextNodeRenderable,
  isVNode,
  isValidBorderStyle,
  italic,
  link,
  magenta,
  maybeMakeRenderable,
  measureText,
  nonAlphanumericKeys,
  normalizeColorValue,
  normalizeIndexedColorIndex,
  normalizeTerminalPalette,
  parseAlign,
  parseAlignItems,
  parseBorderStyle,
  parseBoxSizing,
  parseColor,
  parseDimension,
  parseDirection,
  parseDisplay,
  parseEdge,
  parseFlexDirection,
  parseGutter,
  parseJustify,
  parseKeypress,
  parseLogLevel,
  parseMeasureMode,
  parseOverflow,
  parsePositionType,
  parseUnit,
  parseWrap,
  pathToFiletype,
  red,
  registerCorePlugin,
  registerEnvVar,
  renderFontToFrameBuffer,
  resolveCoreSlot,
  resolveRenderLib,
  reverse,
  rgbToHex,
  setRenderLibPath,
  setupAudio,
  showCommandPalette,
  strikethrough,
  stringToStyledText,
  stripAnsiSequences,
  t,
  terminalNamedSingleStrokeKeys,
  treeSitterToStyledText,
  treeSitterToTextChunks,
  underline,
  validateImageDimensions,
  visualizeRenderableTree,
  vstyles,
  white,
  wrapWithDelegates,
  yellow
};
