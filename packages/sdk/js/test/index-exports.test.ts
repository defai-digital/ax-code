import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import * as sdk from "../src/index"
import type { Project } from "../src/index"

describe("@ax-code/sdk top-level exports", () => {
  test("package manifest exposes headless and gRPC SDK surfaces only", () => {
    const packageJson = JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")) as {
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
    ])
    expect(publicSubpaths).not.toContain("./http")
    expect(publicSubpaths).not.toContain("./client")
    expect(publicSubpaths).not.toContain("./server")
    expect(publicSubpaths).not.toContain("./v2")
    expect(publicSubpaths).not.toContain("./v2/client")
    expect(publicSubpaths).not.toContain("./v2/server")
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
