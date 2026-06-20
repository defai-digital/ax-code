import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import * as sdk from "../src/index"
import type { Project } from "../src/index"

describe("@ax-code/sdk top-level exports", () => {
  test("package manifest exposes supported SDK surfaces from published dist files", () => {
    const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")) as {
      exports: Record<string, string>
    }
    const publicSubpaths = Object.keys(packageJson.exports)

    expect(publicSubpaths).toEqual([
      ".",
      "./testing",
      "./programmatic",
      "./grpc",
      "./grpc/node",
      "./proto/ax_code/v1/headless.proto",
      "./headless",
      "./headless/client",
      "./headless/event",
      "./headless/projection",
      "./v2",
      "./v2/client",
      "./v2/gen/client",
      "./v2/server",
    ])
    for (const [subpath, target] of Object.entries(packageJson.exports)) {
      expect(target.startsWith("./dist/")).toBe(true)
      expect(subpath.startsWith("./v2") || !target.includes("/v2/")).toBe(true)
    }
    expect(publicSubpaths).not.toContain("./http")
    expect(publicSubpaths).not.toContain("./client")
    expect(publicSubpaths).not.toContain("./server")
  })

  test("does not expose HTTP client or server helpers as runtime values", () => {
    expect("createAgent" in sdk).toBe(true)
    expect("createAxCodeClient" in sdk).toBe(false)
    expect("createOpencodeClient" in sdk).toBe(false)
    expect("createAxCodeServer" in sdk).toBe(false)
    expect("createOpencodeServer" in sdk).toBe(false)
  })

  test("keeps generated route types available for downstream packages", () => {
    const project: Project = {
      id: "proj-1",
      name: "Workspace",
      worktree: "/repo",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    }

    expect(project.id).toBe("proj-1")
  })
})
