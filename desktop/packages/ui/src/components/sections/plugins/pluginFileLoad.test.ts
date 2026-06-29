import { describe, expect, test, vi } from "vitest"

import { loadPluginFileContent } from "./pluginFileLoad"

describe("loadPluginFileContent", () => {
  test("returns loaded plugin file content", async () => {
    const readFile = vi.fn(async () => ({ content: "export default {}" }))

    await expect(loadPluginFileContent("plugin-file", readFile)).resolves.toEqual({
      ok: true,
      content: "export default {}",
    })
    expect(readFile).toHaveBeenCalledWith("plugin-file")
  })

  test("treats missing file content as a failed load", async () => {
    await expect(loadPluginFileContent("plugin-file", vi.fn(async () => null))).resolves.toEqual({ ok: false })
  })

  test("converts thrown reads into failed load results", async () => {
    const error = new Error("read failed")

    await expect(
      loadPluginFileContent(
        "plugin-file",
        vi.fn(async () => {
          throw error
        }),
      ),
    ).resolves.toEqual({ ok: false, error })
  })
})
