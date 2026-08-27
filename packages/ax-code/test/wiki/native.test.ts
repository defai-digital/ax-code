import { afterEach, describe, expect, test, vi } from "vitest"

vi.mock("ai", () => ({ generateObject: vi.fn() }))

vi.mock("@ax-code/ax-wiki", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ax-code/ax-wiki")>()
  return {
    ...actual,
    buildAxWiki: vi.fn(),
  }
})

import { generateObject } from "ai"
import { buildAxWiki, type WikiPageGenerationRequest } from "@ax-code/ax-wiki"
import { Instance } from "../../src/project/instance"
import { runNativeWiki } from "../../src/wiki/native"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  vi.clearAllMocks()
})

describe("wiki native generator", () => {
  test("sends a bounded output limit on every page generateObject call", async () => {
    await using tmp = await tmpdir({ git: true })
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        summary: "A long enough summary of the generated wiki page for schema.",
        body: "A long enough generated wiki page body so the schema minimum length is satisfied.",
        symbols: [],
      },
    } as never)
    vi.mocked(buildAxWiki).mockImplementation(async (input) => {
      const request: WikiPageGenerationRequest = {
        action: "update",
        root: tmp.path,
        wikiDir: "openwiki",
        page: {
          path: "overview.md",
          title: "Overview",
          purpose: "Describe the repository",
          selectors: [],
          kind: "quickstart",
        },
        plan: { schemaVersion: 1, pages: [], modules: [], sourceCount: 0 },
        sources: [],
        sourceInventory: [],
      }
      await input.generator(request)
      return {
        action: "update",
        root: tmp.path,
        wikiDir: "openwiki",
        plan: request.plan,
        generatedPages: ["overview.md"],
        unchangedPages: [],
        removedPages: [],
        conflicts: [],
        manifest: {} as never,
        validation: {} as never,
      }
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        const { Env } = await import("../../src/env")
        Env.set("GROQ_API_KEY", "test-api-key")
      },
      fn: async () => {
        await runNativeWiki({ root: tmp.path, action: "update" })
      },
    })

    expect(generateObject).toHaveBeenCalledTimes(1)
    const request = vi.mocked(generateObject).mock.calls[0]?.[0] as { maxOutputTokens?: number }
    expect(request.maxOutputTokens).toEqual(expect.any(Number))
    expect(request.maxOutputTokens).toBeGreaterThan(0)
  })
})
