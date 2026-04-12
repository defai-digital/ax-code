import { describe, expect, test } from "bun:test"
import {
  OPENTUI_SOLID_LEGACY_PRELOAD_SPECIFIER,
  OPENTUI_SOLID_RUNTIME_PLUGIN_SUPPORT_SPECIFIER,
  loadOpenTuiPreload,
} from "../../../src/cli/cmd/tui/preload-loader"

describe("tui preload loader", () => {
  test("loads OpenTUI runtime plugin support first", async () => {
    const seen: string[] = []

    await loadOpenTuiPreload(async (specifier) => {
      seen.push(specifier)
      return {}
    })

    expect(seen).toEqual([OPENTUI_SOLID_RUNTIME_PLUGIN_SUPPORT_SPECIFIER])
  })

  test("falls back to the legacy OpenTUI preload when runtime plugin support is missing", async () => {
    const seen: string[] = []

    await loadOpenTuiPreload(async (specifier) => {
      seen.push(specifier)
      if (specifier === OPENTUI_SOLID_RUNTIME_PLUGIN_SUPPORT_SPECIFIER) {
        throw new Error(`Cannot find module '${OPENTUI_SOLID_RUNTIME_PLUGIN_SUPPORT_SPECIFIER}'`)
      }
      return {}
    })

    expect(seen).toEqual([OPENTUI_SOLID_RUNTIME_PLUGIN_SUPPORT_SPECIFIER, OPENTUI_SOLID_LEGACY_PRELOAD_SPECIFIER])
  })

  test("does not fall back when runtime plugin support fails after loading", async () => {
    const failure = new Error("runtime plugin support failed")

    await expect(
      loadOpenTuiPreload(async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
  })

  test("throws a contextual error when both OpenTUI preload entrypoints are missing", async () => {
    await expect(
      loadOpenTuiPreload(async (specifier) => {
        throw new Error(`Cannot find module '${specifier}'`)
      }),
    ).rejects.toThrow("Unable to load OpenTUI Solid preload support.")
  })
})
