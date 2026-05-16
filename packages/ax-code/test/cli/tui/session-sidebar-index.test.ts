import { describe, expect, test } from "bun:test"
import { sidebarGraphIndexStatusText } from "../../../src/cli/cmd/tui/routes/session/sidebar-index-view-model"

describe("session sidebar graph index status", () => {
  test("keeps completed empty index runs distinct from never-indexed projects", () => {
    expect(
      sidebarGraphIndexStatusText({
        nodeCount: 0,
        state: "idle",
        completed: 12,
        total: 12,
        error: null,
      }),
    ).toBe("index complete · no code symbols found in this scope")
  })

  test("keeps persisted empty index runs distinct after restart", () => {
    expect(
      sidebarGraphIndexStatusText({
        nodeCount: 0,
        lastIndexedAt: Date.now(),
        state: "idle",
        completed: 0,
        total: 0,
        error: null,
      }),
    ).toBe("index complete · no code symbols found in this scope")
  })

  test("still prompts manual indexing when no index run has completed", () => {
    expect(
      sidebarGraphIndexStatusText({
        nodeCount: 0,
        state: "idle",
        completed: 0,
        total: 0,
        error: null,
      }),
    ).toBe("not indexed · run ax-code index")
  })

  test("renders active and failed index states before idle fallbacks", () => {
    expect(
      sidebarGraphIndexStatusText({
        nodeCount: 0,
        state: "indexing",
        completed: 3,
        total: 9,
        error: null,
      }),
    ).toBe("indexing... (3/9)")

    expect(
      sidebarGraphIndexStatusText({
        nodeCount: 0,
        state: "failed",
        completed: 9,
        total: 9,
        error: "LSP unavailable",
      }),
    ).toBe("index failed: LSP unavailable")
  })

  test("surfaces idle index hints before completed-empty fallbacks", () => {
    expect(
      sidebarGraphIndexStatusText({
        nodeCount: 0,
        state: "idle",
        completed: 1,
        total: 1,
        error: "Indexing is already running in another ax-code process.",
      }),
    ).toBe("Indexing is already running in another ax-code process.")
  })
})
