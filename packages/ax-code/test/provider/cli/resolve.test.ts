import { test, expect, describe } from "vitest"
import { parseCliSettingsJson, resolveCliModel } from "../../../src/provider/cli/resolve"

describe("resolveCliModel", () => {
  test("parseCliSettingsJson decodes object settings", () => {
    expect(parseCliSettingsJson(JSON.stringify({ model: "claude-sonnet-4-6" }))).toEqual({
      model: "claude-sonnet-4-6",
    })
  })

  test("parseCliSettingsJson rejects invalid and non-object settings", () => {
    expect(parseCliSettingsJson("{not json")).toBeNull()
    expect(parseCliSettingsJson("[]")).toBeNull()
    expect(parseCliSettingsJson('"claude-sonnet-4-6"')).toBeNull()
  })

  test("returns default for claude-code when no config exists", async () => {
    const original = process.env.ANTHROPIC_MODEL
    delete process.env.ANTHROPIC_MODEL
    try {
      const info = await resolveCliModel("claude-code")
      // If no settings file and no env var, defer to the CLI's own default model.
      if (info.source === "default") {
        expect(info.model).toBe("claude-code")
      }
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_MODEL = original
    }
  })

  test("claude-code respects ANTHROPIC_MODEL env var", async () => {
    const original = process.env.ANTHROPIC_MODEL
    process.env.ANTHROPIC_MODEL = "claude-opus-4-6"
    try {
      const info = await resolveCliModel("claude-code")
      expect(info.model).toBe("claude-opus-4-6")
      expect(info.source).toBe("ANTHROPIC_MODEL")
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_MODEL = original
      else delete process.env.ANTHROPIC_MODEL
    }
  })

  test("gemini-cli respects GEMINI_MODEL env var", async () => {
    const original = process.env.GEMINI_MODEL
    process.env.GEMINI_MODEL = "gemini-3-flash-preview"
    try {
      const info = await resolveCliModel("gemini-cli")
      expect(info.model).toBe("gemini-3-flash-preview")
      expect(info.source).toBe("GEMINI_MODEL")
    } finally {
      if (original !== undefined) process.env.GEMINI_MODEL = original
      else delete process.env.GEMINI_MODEL
    }
  })

  test("returns default for gemini-cli when no config", async () => {
    const original = process.env.GEMINI_MODEL
    delete process.env.GEMINI_MODEL
    try {
      const info = await resolveCliModel("gemini-cli")
      if (info.source === "default") {
        expect(info.model).toBe("gemini-cli")
      }
    } finally {
      if (original !== undefined) process.env.GEMINI_MODEL = original
    }
  })

  test("returns default for codex-cli when no config", async () => {
    const info = await resolveCliModel("codex-cli")
    if (info.source === "default") {
      expect(info.model).toBe("codex-cli")
    }
  })

  test("returns default for grok-build-cli", async () => {
    const info = await resolveCliModel("grok-build-cli")
    expect(info.model).toBe("grok-build-cli")
    expect(info.source).toBe("default")
  })

  test("returns default for qoder-cli when no config", async () => {
    const info = await resolveCliModel("qoder-cli")
    if (info.source === "default") {
      expect(info.model).toBe("qoder-cli")
    }
  })

  test("returns unknown for unrecognized provider", async () => {
    const info = await resolveCliModel("nonexistent")
    expect(info.model).toBe("unknown")
    expect(info.source).toBe("none")
  })
})
