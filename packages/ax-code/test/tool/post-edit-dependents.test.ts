import { beforeEach, describe, expect, test } from "vitest"
import {
  appendPostEditDependentsNotice,
  postEditDependentsNotice,
  __resetPostEditDependentsForTests,
  type DependentsGraphAccess,
} from "../../src/tool/post-edit-dependents"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// ADR-217: the post-edit dependents notice is off by default, bounded to
// 5 files per notice, deduplicated per session, and silent on every
// failure mode (stale graph, no dependents, lookup error, timeout).

beforeEach(() => {
  __resetPostEditDependentsForTests()
})

function fakeGraph(behavior: { fresh?: () => boolean; dependents?: string[]; hang?: boolean; failOnFresh?: boolean }) {
  const calls = { fresh: 0, dependents: 0 }
  const graph: DependentsGraphAccess = {
    fresh: () => {
      calls.fresh++
      if (behavior.failOnFresh) throw new Error("graph unavailable")
      return behavior.fresh ? behavior.fresh() : true
    },
    dependents: () => {
      calls.dependents++
      if (behavior.hang) return new Promise<string[]>(() => {})
      return behavior.dependents ?? []
    },
  }
  return { calls, graph }
}

const PROJECT = "proj_test"
const SESSION = "ses_test"
const OTHER_SESSION = "ses_other"
const FILE = "/repo/src/alpha.ts"

describe("postEditDependentsNotice (ADR-217)", () => {
  test("flag off returns nothing and never touches the graph", async () => {
    const { calls, graph } = fakeGraph({ dependents: ["/repo/src/beta.ts"] })
    const output = await postEditDependentsNotice({
      projectID: PROJECT,
      sessionID: SESSION,
      file: FILE,
      enabled: false,
      graph,
    })
    expect(output).toBe("")
    expect(calls.fresh).toBe(0)
    expect(calls.dependents).toBe(0)
  })

  test("flag on lists dependents capped at 5", async () => {
    const dependents = ["/b1.ts", "/b2.ts", "/b3.ts", "/b4.ts", "/b5.ts", "/b6.ts", "/b7.ts", "/b8.ts"]
    const { graph } = fakeGraph({ dependents })
    const output = await postEditDependentsNotice({
      projectID: PROJECT,
      sessionID: SESSION,
      file: FILE,
      enabled: true,
      graph,
    })
    expect(output).toContain(`Files that import ${FILE}`)
    for (const dependent of dependents.slice(0, 5)) expect(output).toContain(`- ${dependent}`)
    expect(output).not.toContain("/b6.ts")
  })

  test("never lists the edited file itself", async () => {
    const { graph } = fakeGraph({ dependents: [FILE, "/repo/src/beta.ts"] })
    const output = await postEditDependentsNotice({
      projectID: PROJECT,
      sessionID: SESSION,
      file: FILE,
      enabled: true,
      graph,
    })
    expect(output).toContain("- /repo/src/beta.ts")
    expect(output.match(new RegExp(`- ${FILE.replace(/\//g, "\\/")}$`, "m"))).toBeNull()
  })

  test("deduplicates dependents across calls within one session", async () => {
    const { graph } = fakeGraph({ dependents: ["/b1.ts", "/b2.ts"] })
    const first = await postEditDependentsNotice({
      projectID: PROJECT,
      sessionID: SESSION,
      file: FILE,
      enabled: true,
      graph,
    })
    expect(first).toContain("- /b1.ts")
    expect(first).toContain("- /b2.ts")
    // Same dependents reported again in the same session: silent.
    const second = await postEditDependentsNotice({
      projectID: PROJECT,
      sessionID: SESSION,
      file: FILE,
      enabled: true,
      graph,
    })
    expect(second).toBe("")
    // A different session starts with a clean dedupe set.
    const otherSession = await postEditDependentsNotice({
      projectID: PROJECT,
      sessionID: OTHER_SESSION,
      file: FILE,
      enabled: true,
      graph,
    })
    expect(otherSession).toContain("- /b1.ts")
  })

  test("silent when there are no dependents", async () => {
    const { graph } = fakeGraph({ dependents: [] })
    const output = await postEditDependentsNotice({
      projectID: PROJECT,
      sessionID: SESSION,
      file: FILE,
      enabled: true,
      graph,
    })
    expect(output).toBe("")
  })

  test("stale or unindexed graph is silent and skips the dependents query", async () => {
    const { calls, graph } = fakeGraph({ fresh: () => false, dependents: ["/b1.ts"] })
    const output = await postEditDependentsNotice({
      projectID: PROJECT,
      sessionID: SESSION,
      file: FILE,
      enabled: true,
      graph,
    })
    expect(output).toBe("")
    expect(calls.fresh).toBe(1)
    expect(calls.dependents).toBe(0)
  })

  test("graph error is silent", async () => {
    const { graph } = fakeGraph({ failOnFresh: true })
    const output = await postEditDependentsNotice({
      projectID: PROJECT,
      sessionID: SESSION,
      file: FILE,
      enabled: true,
      graph,
    })
    expect(output).toBe("")
  })

  test("lookup exceeding the 200 ms budget is silent", async () => {
    const { graph } = fakeGraph({ hang: true })
    const started = Date.now()
    const output = await postEditDependentsNotice({
      projectID: PROJECT,
      sessionID: SESSION,
      file: FILE,
      enabled: true,
      graph,
    })
    expect(output).toBe("")
    expect(Date.now() - started).toBeGreaterThanOrEqual(190)
  }, 5_000)
})

describe("appendPostEditDependentsNotice config plumbing", () => {
  test("default config leaves output unchanged and never queries the graph", async () => {
    const { tmpdir } = await import("../fixture/fixture")
    const { Instance } = await import("../../src/project/instance")
    await using tmp = await tmpdir({ git: true, config: { username: "testuser" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { calls, graph } = fakeGraph({ dependents: ["/b1.ts"] })
        const output = await appendPostEditDependentsNotice("base output", { sessionID: SESSION }, FILE, graph)
        expect(output).toBe("base output")
        expect(calls.fresh).toBe(0)
      },
    })
  })

  test("enabled config appends the notice", async () => {
    const { tmpdir } = await import("../fixture/fixture")
    const { Instance } = await import("../../src/project/instance")
    await using tmp = await tmpdir({
      git: true,
      config: { username: "testuser", code_intelligence: { post_edit_dependents: true } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { graph } = fakeGraph({ dependents: ["/repo/src/beta.ts"] })
        const output = await appendPostEditDependentsNotice("base output", { sessionID: SESSION }, FILE, graph)
        expect(output).toContain("base output")
        expect(output).toContain(`Files that import ${FILE}`)
        expect(output).toContain("- /repo/src/beta.ts")
      },
    })
  })
})
