import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { CORE_BACKED_FS_ROUTES, DESKTOP_OWNED_FS_MUTATION_ROUTES, isCoreBackedFsRoute } from "./desktop-owned-routes.js"

const here = path.dirname(fileURLToPath(import.meta.url))

describe("desktop owned route surface", () => {
  it("marks read/list/raw as core-backed and keeps mutations on Desktop", () => {
    expect(isCoreBackedFsRoute("GET", "/api/fs/read")).toBe(true)
    expect(isCoreBackedFsRoute("GET", "/api/fs/raw")).toBe(true)
    expect(isCoreBackedFsRoute("POST", "/api/fs/write")).toBe(false)
    expect(DESKTOP_OWNED_FS_MUTATION_ROUTES).toContain("POST /api/fs/write")
    expect(CORE_BACKED_FS_ROUTES).toHaveLength(3)
  })

  it("does not implement GET /api/fs/read, list, or raw with local open/readdir", () => {
    const source = readFileSync(path.join(here, "fs/routes.js"), "utf8")
    const readHandler = source.slice(source.indexOf('app.get("/api/fs/read"'), source.indexOf('app.get("/api/fs/raw"'))
    const rawHandler = source.slice(source.indexOf('app.get("/api/fs/raw"'), source.indexOf('app.post("/api/fs/write"'))
    const listHandler = source.slice(source.indexOf('app.get("/api/fs/list"'))
    expect(readHandler).toContain("coreFileAdapter.read")
    expect(readHandler).not.toContain("fsPromises.open")
    expect(rawHandler).toContain("coreFileAdapter.raw")
    expect(rawHandler).not.toContain("fsPromises.open")
    expect(listHandler).toContain("coreFileAdapter.list")
    expect(listHandler).not.toContain("fsPromises.readdir")
  })

  it("keeps Git/GitHub/quota adapters and uses core search", () => {
    const feature = readFileSync(path.join(here, "ax-code/feature-routes-runtime.js"), "utf8")
    expect(feature).toContain("registerGitRoutes")
    expect(feature).toContain("createCoreFileAdapter")
    const search = readFileSync(path.join(here, "fs/search.js"), "utf8")
    expect(search).toContain("coreFileAdapter.search")
    expect(search).not.toContain("fsPromises.readdir")
  })
})
