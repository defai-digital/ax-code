import { describe, expect, test } from "bun:test"
import { RuntimeHotPath } from "../../src/runtime/hot-path"

describe("RuntimeHotPath", () => {
  test("captures the current hot-path inventory", () => {
    const names = RuntimeHotPath.list().map((item) => item.name)

    expect(names).toEqual([
      "Project.fromDirectory",
      "Format.init",
      "Plugin.init",
      "LSP.init",
      "Provider.warmup",
      "File.init",
      "FileWatcher.init",
      "Vcs.init",
      "Snapshot.init",
      "Session.pruneExpired",
      "SessionStatus.service",
      "Permission.requests",
      "Question.requests",
      "disposeInstance",
    ])
  })

  test("tracks migrated promise services and remaining effect-backed boundaries", () => {
    const project = RuntimeHotPath.get("Project.fromDirectory")
    const format = RuntimeHotPath.get("Format.init")
    const plugin = RuntimeHotPath.get("Plugin.init")
    const file = RuntimeHotPath.get("File.init")
    const watcher = RuntimeHotPath.get("FileWatcher.init")
    const vcs = RuntimeHotPath.get("Vcs.init")
    const snapshot = RuntimeHotPath.get("Snapshot.init")
    const sessionStatus = RuntimeHotPath.get("SessionStatus.service")
    const permission = RuntimeHotPath.get("Permission.requests")
    const question = RuntimeHotPath.get("Question.requests")
    const dispose = RuntimeHotPath.get("disposeInstance")

    expect(project).toMatchObject({
      dependencyMode: "promise",
      phase0Action: "observe_only",
    })
    expect(format).toMatchObject({
      dependencyMode: "promise",
      phase0Action: "observe_only",
    })
    expect(plugin).toMatchObject({
      dependencyMode: "promise",
      phase0Action: "observe_only",
    })
    expect(file).toMatchObject({
      dependencyMode: "promise",
      phase0Action: "observe_only",
    })
    expect(watcher).toMatchObject({
      dependencyMode: "promise",
      phase0Action: "observe_only",
    })
    expect(vcs).toMatchObject({
      dependencyMode: "promise",
      phase0Action: "observe_only",
    })
    expect(snapshot).toMatchObject({
      dependencyMode: "promise",
      phase0Action: "observe_only",
    })
    expect(sessionStatus).toMatchObject({
      dependencyMode: "promise",
      phase0Action: "observe_only",
    })
    expect(permission).toMatchObject({
      dependencyMode: "promise",
      phase0Action: "observe_only",
    })
    expect(question).toMatchObject({
      dependencyMode: "promise",
      phase0Action: "observe_only",
    })
    expect(dispose).toMatchObject({
      dependencyMode: "promise",
      phase0Action: "observe_only",
    })
    expect(permission?.triggers).toContain("startup")
    expect(question?.triggers).toContain("live_update")
    expect(dispose?.triggers).toContain("shutdown")
  })
})
