import { describe, expect, test } from "bun:test"
import * as sdk from "../src/index"
import type { Project } from "../src/index"

describe("@ax-code/sdk top-level exports", () => {
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
