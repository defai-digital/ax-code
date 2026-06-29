import { describe, expect, test, vi } from "vitest"

import { parseSnippetAliases, saveSnippet } from "./snippetSave"

describe("snippetSave", () => {
  test("normalizes new snippet names and aliases before creating", async () => {
    const createSnippet = vi.fn(async () => true)
    const updateSnippet = vi.fn(async () => false)

    const result = await saveSnippet({
      isNew: true,
      name: "daily note",
      content: "content",
      aliases: "today, daily, , journal ",
      description: "Personal note template",
      scope: "global",
      createSnippet,
      updateSnippet,
    })

    expect(result).toEqual({ status: "saved" })
    expect(createSnippet).toHaveBeenCalledWith("daily-note", "content", {
      aliases: ["today", "daily", "journal"],
      description: "Personal note template",
      scope: "global",
    })
    expect(updateSnippet).not.toHaveBeenCalled()
  })

  test("reports thrown save failures without rejecting the caller", async () => {
    const error = new Error("network closed")

    const result = await saveSnippet({
      isNew: false,
      name: "daily-note",
      content: "content",
      aliases: "",
      description: "",
      scope: "global",
      createSnippet: vi.fn(async () => true),
      updateSnippet: vi.fn(async () => {
        throw error
      }),
    })

    expect(result).toEqual({ status: "unexpected-error", error })
  })

  test("validates required fields before calling the store", async () => {
    const createSnippet = vi.fn(async () => true)
    const updateSnippet = vi.fn(async () => true)

    await expect(
      saveSnippet({
        isNew: true,
        name: "  ",
        content: "content",
        aliases: "",
        description: "",
        scope: "global",
        createSnippet,
        updateSnippet,
      }),
    ).resolves.toEqual({ status: "name-required" })

    await expect(
      saveSnippet({
        isNew: false,
        name: "existing",
        content: "   ",
        aliases: "",
        description: "",
        scope: "global",
        createSnippet,
        updateSnippet,
      }),
    ).resolves.toEqual({ status: "content-required" })

    expect(createSnippet).not.toHaveBeenCalled()
    expect(updateSnippet).not.toHaveBeenCalled()
  })

  test("parses comma-separated aliases", () => {
    expect(parseSnippetAliases("alpha, beta,, gamma ")).toEqual(["alpha", "beta", "gamma"])
  })
})
