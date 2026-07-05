import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMockResponse, createRouteRegistry } from "../../test-helpers/route-harness.js"

const gitLibraries = {
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
}

vi.doMock("./index.js", () => ({
  stageFiles: gitLibraries.stageFiles,
  unstageFiles: gitLibraries.unstageFiles,
}))

const { registerGitRoutes } = await import("./routes.js")

describe("git routes index mutations", () => {
  beforeEach(() => {
    gitLibraries.stageFiles.mockReset()
    gitLibraries.unstageFiles.mockReset()
  })

  it("accepts legacy stage path payloads", async () => {
    const { app, getRoute } = createRouteRegistry()
    registerGitRoutes(app)
    const response = createMockResponse()

    await getRoute("POST", "/api/git/stage")({ query: { directory: "/repo" }, body: { path: "a.ts" } }, response)

    expect(response.statusCode).toBe(200)
    expect(gitLibraries.stageFiles).toHaveBeenCalledWith("/repo", ["a.ts"])
  })

  it("accepts bulk stage paths payloads", async () => {
    const { app, getRoute } = createRouteRegistry()
    registerGitRoutes(app)
    const response = createMockResponse()

    await getRoute("POST", "/api/git/stage")(
      { query: { directory: "/repo" }, body: { paths: ["a.ts", "b.ts"] } },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(gitLibraries.stageFiles).toHaveBeenCalledWith("/repo", ["a.ts", "b.ts"])
  })

  it("filters invalid bulk stage path entries before calling git", async () => {
    const { app, getRoute } = createRouteRegistry()
    registerGitRoutes(app)
    const response = createMockResponse()

    await getRoute("POST", "/api/git/stage")(
      { query: { directory: "/repo" }, body: { paths: [" a.ts ", "", null, "b.ts"] } },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(gitLibraries.stageFiles).toHaveBeenCalledWith("/repo", ["a.ts", "b.ts"])
  })

  it("accepts legacy unstage path payloads", async () => {
    const { app, getRoute } = createRouteRegistry()
    registerGitRoutes(app)
    const response = createMockResponse()

    await getRoute("POST", "/api/git/unstage")({ query: { directory: "/repo" }, body: { path: "a.ts" } }, response)

    expect(response.statusCode).toBe(200)
    expect(gitLibraries.unstageFiles).toHaveBeenCalledWith("/repo", ["a.ts"])
  })

  it("accepts bulk unstage paths payloads", async () => {
    const { app, getRoute } = createRouteRegistry()
    registerGitRoutes(app)
    const response = createMockResponse()

    await getRoute("POST", "/api/git/unstage")(
      { query: { directory: "/repo" }, body: { paths: ["a.ts", "b.ts"] } },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(gitLibraries.unstageFiles).toHaveBeenCalledWith("/repo", ["a.ts", "b.ts"])
  })

  it("filters invalid bulk unstage path entries before calling git", async () => {
    const { app, getRoute } = createRouteRegistry()
    registerGitRoutes(app)
    const response = createMockResponse()

    await getRoute("POST", "/api/git/unstage")(
      { query: { directory: "/repo" }, body: { paths: [" a.ts ", "", undefined, "b.ts"] } },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(gitLibraries.unstageFiles).toHaveBeenCalledWith("/repo", ["a.ts", "b.ts"])
  })

  it("rejects invalid path payloads before calling git", async () => {
    const { app, getRoute } = createRouteRegistry()
    registerGitRoutes(app)
    const response = createMockResponse()

    await getRoute("POST", "/api/git/stage")({ query: { directory: "/repo" }, body: { paths: [" ", null] } }, response)

    expect(response.statusCode).toBe(400)
    expect(response.body).toEqual({ error: "path parameter is required" })
    expect(gitLibraries.stageFiles).not.toHaveBeenCalled()
  })
})
