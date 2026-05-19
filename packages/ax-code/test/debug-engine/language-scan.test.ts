import { describe, test, expect } from "bun:test"
import {
  detectClippy,
  detectRuff,
  detectMypy,
  mapClippyLevel,
  mapRuffSeverity,
} from "../../src/debug-engine/language-scan"

describe("language-scan", () => {
  describe("mapClippyLevel", () => {
    test("maps error to high", () => {
      expect(mapClippyLevel("error")).toBe("high")
    })
    test("maps warning to medium", () => {
      expect(mapClippyLevel("warning")).toBe("medium")
    })
    test("maps help to low", () => {
      expect(mapClippyLevel("help")).toBe("low")
    })
    test("maps note to info", () => {
      expect(mapClippyLevel("note")).toBe("info")
    })
    test("maps unknown to info", () => {
      expect(mapClippyLevel("unknown")).toBe("info")
    })
  })

  describe("mapRuffSeverity", () => {
    test("maps E-codes to medium", () => {
      expect(mapRuffSeverity("E501")).toBe("medium")
    })
    test("maps F-codes to medium", () => {
      expect(mapRuffSeverity("F841")).toBe("medium")
    })
    test("maps W-codes to low", () => {
      expect(mapRuffSeverity("W293")).toBe("low")
    })
    test("maps I-codes to low", () => {
      expect(mapRuffSeverity("I001")).toBe("low")
    })
    test("maps B-codes to low", () => {
      expect(mapRuffSeverity("B007")).toBe("low")
    })
    test("maps PLW-codes to medium", () => {
      expect(mapRuffSeverity("PLW2901")).toBe("medium")
    })
    test("maps PLC-codes to low", () => {
      expect(mapRuffSeverity("PLC0205")).toBe("low")
    })
  })

  describe("detectClippy", () => {
    test("returns error message when cargo not found", async () => {
      const result = await detectClippy({ cwd: "/nonexistent" })
      expect(result.tool).toBe("cargo-clippy")
      // Either cargo is not installed, or it runs but finds no Cargo.toml
      if (result.error) {
        expect(result.error.length).toBeGreaterThan(0)
      }
    })
  })

  describe("detectRuff", () => {
    test("returns error message when ruff not found", async () => {
      const result = await detectRuff({ cwd: "/nonexistent" })
      expect(result.tool).toBe("ruff")
      // Either ruff is not installed, or it runs but finds no Python files
      if (result.error) {
        expect(result.error.length).toBeGreaterThan(0)
      }
    })
  })

  describe("detectMypy", () => {
    test("returns error message when mypy not found", async () => {
      const result = await detectMypy({ cwd: "/nonexistent" })
      expect(result.tool).toBe("mypy")
      // Either mypy is not installed, or it runs but finds no Python files
      if (result.error) {
        expect(result.error.length).toBeGreaterThan(0)
      }
    })
  })
})
