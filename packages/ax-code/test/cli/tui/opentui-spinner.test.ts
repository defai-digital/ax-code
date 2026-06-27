import { describe, expect, test } from "vitest"
import {
  getSpinnerPreset,
  getSpinnerNames,
  randomSpinner,
} from "../../../../opentui-spinner/src/presets"
import presets from "../../../../opentui-spinner/src/presets"
import {
  createStatic,
  createPulse,
  createWave,
  createRainbow,
} from "../../../../opentui-spinner/src/utils"

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

describe("opentui-spinner presets", () => {
  test("exposes exactly 40 built-in presets", () => {
    expect(getSpinnerNames()).toHaveLength(40)
  })

  test("every preset has a positive interval and non-empty frames", () => {
    for (const name of getSpinnerNames()) {
      const preset = getSpinnerPreset(name)
      expect(preset, `preset "${name}" should exist`).toBeDefined()
      expect(preset!.interval).toBeGreaterThan(0)
      expect(preset!.frames.length).toBeGreaterThan(0)
      for (const frame of preset!.frames) {
        expect(typeof frame).toBe("string")
        expect(frame.length).toBeGreaterThan(0)
      }
    }
  })

  test("default export matches getSpinnerPreset", () => {
    for (const name of getSpinnerNames()) {
      expect(presets[name]).toEqual(getSpinnerPreset(name))
    }
  })

  test("getSpinnerPreset returns undefined for unknown names", () => {
    expect(getSpinnerPreset("nonexistent" as any)).toBeUndefined()
  })

  test("randomSpinner returns a valid preset", () => {
    const preset = randomSpinner()
    expect(preset.interval).toBeGreaterThan(0)
    expect(preset.frames.length).toBeGreaterThan(0)
    // The returned preset must match one of the known presets
    const allPresets = getSpinnerNames().map(getSpinnerPreset)
    expect(allPresets).toContainEqual(preset)
  })

  test("known preset names are present", () => {
    const names = getSpinnerNames()
    for (const expected of ["dots", "line", "arc", "bouncingBar", "aesthetic"]) {
      expect(names).toContain(expected)
    }
  })
})

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

describe("createStatic", () => {
  test("always returns the given color regardless of position", () => {
    const gen = createStatic("red")
    expect(gen(0, 0, 10, 5)).toBe("red")
    expect(gen(5, 3, 10, 5)).toBe("red")
    expect(gen(99, 99, 100, 100)).toBe("red")
  })
})

describe("createPulse", () => {
  test("cycles through colors based on frame index", () => {
    const gen = createPulse(["red", "green", "blue"])
    expect(gen(0, 0, 10, 5)).toBe("red")
    expect(gen(1, 0, 10, 5)).toBe("green")
    expect(gen(2, 0, 10, 5)).toBe("blue")
    expect(gen(3, 0, 10, 5)).toBe("red") // wraps
  })

  test("speed parameter scales frame progression", () => {
    const gen = createPulse(["a", "b", "c", "d"], 2)
    expect(gen(0, 0, 10, 5)).toBe("a")
    expect(gen(1, 0, 10, 5)).toBe("c") // floor(1*2) % 4 = 2
  })

  test("throws on empty colors array", () => {
    expect(() => createPulse([])).toThrow("createPulse")
  })

  test("clamps negative speed to zero", () => {
    const gen = createPulse(["x", "y"], -1)
    // speed clamped to 0, so floor(frame*0) % 2 = 0 always
    expect(gen(5, 0, 10, 5)).toBe("x")
  })
})

describe("createWave", () => {
  test("returns first color when totalChars is zero or negative", () => {
    const gen = createWave(["red", "blue"])
    expect(gen(0, 0, 10, 0)).toBe("red")
    expect(gen(0, 0, 10, -1)).toBe("red")
  })

  test("produces a wave pattern across characters", () => {
    const colors = ["a", "b", "c"]
    const gen = createWave(colors)
    // At frame 0, char 0 of 6: progress=0, index=floor(0/6*3)=0 → "a"
    expect(gen(0, 0, 10, 6)).toBe("a")
    // At frame 0, char 4 of 6: progress=4, index=floor(4/6*3)=floor(2)=2 → "c"
    expect(gen(0, 4, 10, 6)).toBe("c")
  })

  test("throws on empty colors array", () => {
    expect(() => createWave([])).toThrow("createWave")
  })
})

describe("createRainbow", () => {
  test("returns a ColorGenerator function", () => {
    const gen = createRainbow()
    expect(typeof gen).toBe("function")
  })

  test("produces hex color strings", () => {
    const gen = createRainbow()
    const color = gen(0, 0, 10, 5)
    expect(typeof color).toBe("string")
    expect(color).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
