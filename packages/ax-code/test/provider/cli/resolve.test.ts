import { test, expect, describe, afterEach } from "bun:test"
import { resolveCliModel } from "../../../src/provider/cli/resolve"
import * as fs from "fs/promises"
import path from "path"
import os from "os"

const HOME = os.homedir()

describe("resolveCliModel", () => {
  test("returns default for claude-code when no config exists", async () => {
    const original = process.env.ANTHROPIC_MODEL
    delete process.env.ANTHROPIC_MODEL
    try {
      const info = await resolveCliModel("claude-code")
      // If no settings file and no env var, should return default
      if (info.source === "default") {
        expect(info.model).toBe("claude-sonnet-4-6")
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
        expect(info.model).toBe("gemini-2.5-pro")
      }
    } finally {
      if (original !== undefined) process.env.GEMINI_MODEL = original
    }
  })

  test("returns default for codex-cli when no config", async () => {
    const info = await resolveCliModel("codex-cli")
    if (info.source === "default") {
      expect(info.model).toBe("gpt-5.4")
    }
  })

  test("returns unknown for unrecognized provider", async () => {
    const info = await resolveCliModel("nonexistent")
    expect(info.model).toBe("unknown")
    expect(info.source).toBe("none")
  })
})
