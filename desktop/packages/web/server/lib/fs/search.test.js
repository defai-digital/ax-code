import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { createFsSearchRuntime } from "./search.js"

describe("fs search runtime", () => {
  it("searches through the core file adapter instead of local readdir", async () => {
    const coreFileAdapter = { search: vi.fn(async () => ["src/favicon.png"]) }
    const runtime = createFsSearchRuntime({ coreFileAdapter, path: path.posix })
    await expect(runtime.searchFilesystemFiles("/repo", { query: "favicon", limit: 20 })).resolves.toEqual([
      { name: "favicon.png", path: "/repo/src/favicon.png", relativePath: "src/favicon.png", extension: "png" },
    ])
    expect(coreFileAdapter.search).toHaveBeenCalled()
  })
})
