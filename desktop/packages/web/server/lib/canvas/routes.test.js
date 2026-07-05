import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { registerCanvasRoutes } from "./routes.js"
import { createMockResponse, createRouteRegistry } from "../../test-helpers/route-harness.js"

const tempRoots = []

const createCanvasRouteHarness = async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ax-canvas-test-"))
  tempRoots.push(projectRoot)
  const { app, getRoute } = createRouteRegistry()

  registerCanvasRoutes(app, {
    fsPromises: await import("node:fs/promises"),
    path,
    resolveProjectDirectory: async (req) => {
      if (req.query?.directory === projectRoot) {
        return { directory: projectRoot }
      }
      return { directory: null, error: "Project directory is required" }
    },
  })

  return {
    projectRoot,
    getCanvas: getRoute("GET", "/api/canvas"),
    putCanvas: getRoute("PUT", "/api/canvas"),
  }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("canvas routes", () => {
  it("returns a default document without creating a file on first read", async () => {
    const { projectRoot, getCanvas } = await createCanvasRouteHarness()
    const response = createMockResponse()

    await getCanvas({ query: { directory: projectRoot } }, response)

    expect(response.statusCode).toBe(200)
    expect(response.body.document).toMatchObject({
      version: 1,
      id: "main",
      title: "Project Canvas",
      elements: [],
    })
    await expect(readFile(path.join(projectRoot, ".ax-code/canvas/main.canvas.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
  })

  it("writes a sanitized versioned document under the project canvas directory", async () => {
    const { projectRoot, putCanvas } = await createCanvasRouteHarness()
    const response = createMockResponse()

    await putCanvas(
      {
        query: { directory: projectRoot },
        body: {
          document: {
            version: 1,
            title: "Roadmap",
            elements: [
              {
                id: "canvas-note-1",
                type: "note",
                x: 10.2,
                y: 20.8,
                width: 260,
                height: 180,
                text: "Plan the visual workflow",
                color: "green",
              },
            ],
          },
        },
      },
      response,
    )

    expect(response.statusCode).toBe(200)
    expect(response.body.document.elements[0]).toMatchObject({
      id: "canvas-note-1",
      type: "note",
      x: 10,
      y: 21,
      text: "Plan the visual workflow",
      color: "green",
    })

    const saved = JSON.parse(await readFile(path.join(projectRoot, ".ax-code/canvas/main.canvas.json"), "utf8"))
    expect(saved.version).toBe(1)
    expect(saved.elements).toHaveLength(1)
  })

  it("rejects unsupported document versions", async () => {
    const { projectRoot, putCanvas } = await createCanvasRouteHarness()
    const response = createMockResponse()

    await putCanvas(
      {
        query: { directory: projectRoot },
        body: {
          document: {
            version: 99,
            elements: [],
          },
        },
      },
      response,
    )

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toContain("Unsupported canvas document version")
  })

  it("does not silently replace a malformed stored canvas with an empty document", async () => {
    const { projectRoot, getCanvas } = await createCanvasRouteHarness()
    const canvasPath = path.join(projectRoot, ".ax-code/canvas/main.canvas.json")
    await mkdir(path.dirname(canvasPath), { recursive: true })
    await writeFile(canvasPath, "{not-json", "utf8")
    const response = createMockResponse()

    await getCanvas({ query: { directory: projectRoot } }, response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toContain("Stored canvas document is invalid")
  })

  it("rejects missing project directories through route validation", async () => {
    const { getCanvas } = await createCanvasRouteHarness()
    const response = createMockResponse()

    await getCanvas({ query: { directory: "/not/approved" } }, response)

    expect(response.statusCode).toBe(400)
    expect(response.body.error).toBe("Project directory is required")
  })
})
