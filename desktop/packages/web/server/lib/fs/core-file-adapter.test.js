import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  createCoreFileAdapter,
  mapCoreFileContentToPlainText,
  mapCoreFileNodesToDirectoryList,
  mapCoreFindFilesToSearchEntries,
} from "./core-file-adapter.js"

describe("core file adapter", () => {
  it("maps core payloads", () => {
    expect(mapCoreFileContentToPlainText({ type: "text", content: "hello" })).toBe("hello")
    expect(mapCoreFileNodesToDirectoryList("/repo", [{ name: "src", absolute: "/repo/src", type: "directory" }])).toEqual({
      directory: "/repo",
      entries: [{ name: "src", path: "/repo/src", isDirectory: true }],
    })
    expect(mapCoreFindFilesToSearchEntries("/repo", ["src/a.ts"], path.posix)[0].path).toBe("/repo/src/a.ts")
  })

  it("reads and searches through the core file contract", async () => {
    const fetchImpl = vi.fn(async (url) => {
      const href = String(url)
      if (href.includes("/file/content")) {
        return { ok: true, json: async () => ({ type: "text", content: "from-core" }) }
      }
      if (href.includes("/find/file")) {
        return { ok: true, json: async () => ["src/a.ts"] }
      }
      return { ok: true, json: async () => [{ name: "a.ts", absolute: "/repo/a.ts", type: "file" }] }
    })
    const adapter = createCoreFileAdapter({
      fetchImpl,
      getBaseUrl: () => "http://127.0.0.1:4090/",
      getHeaders: () => ({ Authorization: "Basic x" }),
    })
    await expect(adapter.read({ path: "/repo/a.ts", directory: "/repo" })).resolves.toBe("from-core")
    await expect(adapter.search({ query: "a.ts", directory: "/repo", limit: 10 })).resolves.toEqual(["src/a.ts"])
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/file/content")
  })
})
