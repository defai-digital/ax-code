import { describe, expect, it, vi } from "vitest"

import { createNotificationTemplateRuntime } from "./template-runtime.js"

const createRuntime = (settings = {}) =>
  createNotificationTemplateRuntime({
    readSettingsFromDisk: async () => settings,
    persistSettings: vi.fn(async () => {}),
    buildAxCodeUrl: (path) => path,
    getAxCodeAuthHeaders: () => ({}),
    resolveGitBinaryForSpawn: () => "git",
  })

describe("notification template runtime zen models", () => {
  it("returns no selectable zen models after provider retirement", async () => {
    const runtime = createRuntime()
    const models = await runtime.fetchFreeZenModels()

    expect(models).toEqual([])
  })

  it("preserves stored zen model value for compatibility without validation", async () => {
    const runtime = createRuntime({ zenModel: "trinity-large-preview-free" })

    await expect(runtime.resolveZenModel()).resolves.toBe("trinity-large-preview-free")
  })
})

describe("notification template text extraction", () => {
  it("extracts, joins, trims, and truncates text parts", () => {
    const runtime = createRuntime()

    expect(
      runtime.extractTextFromParts(
        [
          { type: "tool", text: "" },
          { type: "text", text: " First line " },
          { content: "Second line" },
          { type: "image", content: "" },
        ],
        20,
      ),
    ).toBe("First line \nSecond l")
  })

  it("falls back to legacy message content arrays", () => {
    const runtime = createRuntime()

    expect(
      runtime.extractLastMessageText(
        {
          properties: {
            info: {
              content: [{ type: "text", text: "Alpha" }, { type: "image" }, { text: "Beta" }],
            },
          },
        },
        100,
      ),
    ).toBe("Alpha\nBeta")
  })
})
