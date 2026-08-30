import { describe, expect, test } from "vitest"
import { planRefactorImpl } from "../src/plan-refactor"
import { CodeNodeID } from "../src/id"
import { DebugEngineQuery } from "../src/query"
import { installTestHost } from "./fixture/host"

// planRefactorImpl builds a RefactorEdit list plus a parallel `editGroups`
// array that attributes each edit to the file(s) it touches. RefactorEdit's
// `target` field is documented as "CodeNodeID string or file path" — every
// edit op must use one of those two shapes so the editGroups file lookup
// (keyed by symbol id, falling back to a direct file-path match) can
// resolve it. The "extract" kind's create_symbol edit has no symbol id yet
// (the extracted symbol doesn't exist), so it must use the file-path form.

describe("planRefactor extract-kind edit targets", () => {
  test("create_symbol edit targets a real path and its group carries the file", async () => {
    const { graph } = installTestHost({ vcs: "none" })
    const target = graph.addSymbol({ id: "sym_a", qualifiedName: "Foo.bar", file: "/repo/src/foo.ts" })
    graph.addCallerEdge(target.id, "sym_caller")
    graph.addSymbol({ id: "sym_caller", file: "/repo/src/caller.ts" })

    const plan = await planRefactorImpl("test-project", {
      intent: "extract shared logic",
      targets: [CodeNodeID.make(target.id)],
    })

    expect(plan.kind).toBe("extract")
    const createEdit = plan.edits.find((e) => e.op === "create_symbol")
    expect(createEdit).toBeDefined()
    // The target must be a real file path (or a CodeNodeID) — never a
    // human-readable qualified name, which matches neither shape and
    // silently loses file attribution downstream.
    expect(createEdit!.target).toBe("/repo/src/foo.ts")

    const stored = DebugEngineQuery.getPlan("test-project", plan.planId)
    const createGroup = stored?.edit_groups?.find((g) => g.targets[0] === createEdit!.target)
    expect(createGroup?.files).toEqual(["/repo/src/foo.ts"])
  })
})
