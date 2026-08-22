import { describe, expect, test, vi } from "vitest"
import path from "path"

// Side-effect import: importing the glue configures the engine host
// singleton and registers the bus event.
import "../../src/dre-glue"
import { DreEvent } from "../../src/dre-glue"
import { codeReasonHost, DebugEngine } from "@ax-code/ax-code-reason"
import { CodeIntelligence } from "../../src/code-intelligence"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// Contract between the core glue adapter and @ax-code/ax-code-reason:
// IDs and roots cross the host port as PLAIN strings; branded-ID
// conversion (ProjectID/CodeNodeID) happens here in core, never inside
// the package.

describe("dre-glue host contract", () => {
  test("importing the glue configures the engine host singleton", () => {
    const host = codeReasonHost()
    expect(typeof host.graph.getSymbol).toBe("function")
    expect(typeof host.db.use).toBe("function")
    expect(typeof host.db.transaction).toBe("function")
    expect(typeof host.killTree).toBe("function")
  })

  test("project identity and roots cross as plain strings from the Instance", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const host = codeReasonHost()
        expect(host.projectID()).toBe(Instance.project.id)
        expect(typeof host.projectID()).toBe("string")
        expect(host.projectRoot()).toBe(Instance.directory)
        expect(host.worktreeRoot()).toBe(Instance.worktree)
        expect(host.projectVcs()).toBe(Instance.project.vcs ?? "none")
      },
    })
  })

  test("containsPath delegates to the Instance boundary check", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const host = codeReasonHost()
        expect(host.containsPath(path.join(tmp.path, "src", "index.ts"))).toBe(true)
        expect(host.containsPath("/definitely/outside/the/project.ts")).toBe(false)
      },
    })
  })

  test("graph adapter forwards plain-string IDs to CodeIntelligence unchanged", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const host = codeReasonHost()
        // The adapter must not validate, rebrand, or rewrite the IDs — the
        // exact strings the engine passes must reach the core graph.
        const getSymbol = vi.spyOn(CodeIntelligence, "getSymbol").mockReturnValue(null)
        const findCallers = vi.spyOn(CodeIntelligence, "findCallers").mockReturnValue([])

        expect(host.graph.getSymbol("plain-project", "plain-node")).toBeNull()
        expect(getSymbol).toHaveBeenCalledWith("plain-project", "plain-node", undefined)

        expect(host.graph.findCallers("plain-project", "plain-node", { scope: "none" })).toEqual([])
        expect(findCallers).toHaveBeenCalledWith("plain-project", "plain-node", { scope: "none" })

        getSymbol.mockRestore()
        findCallers.mockRestore()
      },
    })
  })

  test("graph status accepts a plain-string project ID and returns the port shape", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const host = codeReasonHost()
        const status = host.graph.status(Instance.project.id)
        expect(status.projectID).toBe(Instance.project.id)
        expect(typeof status.nodeCount).toBe("number")
        expect(typeof status.edgeCount).toBe("number")
        expect(status.lastCommitSha === null || typeof status.lastCommitSha === "string").toBe(true)
      },
    })
  })

  test("db port delegates use/transaction to the core Database", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const host = codeReasonHost()
        expect(host.db.use(() => 42)).toBe(42)
        expect(host.db.transaction(() => "tx")).toBe("tx")
      },
    })
  })

  test("the correlated-diagnostics bus event reuses the package schema", () => {
    expect(DreEvent.CorrelatedDiagnostics.type).toBe("debug-engine.correlated-diagnostics")
    expect(DreEvent.CorrelatedDiagnostics.type).toBe(DebugEngine.Event.CorrelatedDiagnostics.type)
    // The registered properties schema parses exactly what the package
    // declares — the shapes cannot drift apart.
    const payload = {
      file: "src/a.ts",
      correlations: [
        {
          file: "src/a.ts",
          line: 1,
          message: "boom",
          severity: 1,
          rootCauseFile: null,
          rootCauseSymbol: null,
          rootCauseChain: [],
          confidence: "high",
          lspTimestamp: 1,
          lspServerIDs: ["ts"],
          graphQueryIds: ["q1"],
          graphIndexedAt: 1,
          graphCompleteness: "full",
        },
      ],
    }
    expect(DreEvent.CorrelatedDiagnostics.properties.safeParse(payload).success).toBe(true)
    expect(DebugEngine.Event.CorrelatedDiagnostics.properties.safeParse(payload).success).toBe(true)
  })
})
