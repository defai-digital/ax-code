import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createMagicPromptRuntime } from "./runtime.js"

describe("magic prompt runtime", () => {
  let tempDir

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-magic-prompts-"))
  })

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  const createRuntime = () =>
    createMagicPromptRuntime({
      fsPromises: fs,
      path,
      filePath: path.join(tempDir, "magic-prompts.json"),
    })

  it("normalizes prompt ids consistently when setting and resetting overrides", async () => {
    const runtime = createRuntime()

    await runtime.setOverride(" assistant.visible ", "Use concise replies")
    expect(await runtime.readPromptState()).toMatchObject({
      overrides: {
        "assistant.visible": "Use concise replies",
      },
    })

    await runtime.resetOverride(" assistant.visible ")
    expect(await runtime.readPromptState()).toMatchObject({
      overrides: {},
    })
  })
})
