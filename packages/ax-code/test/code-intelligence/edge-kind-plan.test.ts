import { describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { Database, eq, and, sql } from "../../src/storage/db"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeEdgeTable } from "../../src/code-intelligence/schema.sql"
import { CodeNodeID, CodeEdgeID } from "../../src/code-intelligence/id"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

function now() {
  return Date.now()
}

function makeNode(projectID: ProjectID, name: string) {
  const t = now()
  return {
    id: CodeNodeID.ascending(),
    project_id: projectID,
    kind: "function" as const,
    name,
    qualified_name: name,
    file: "/tmp/file.ts",
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 1,
    range_end_char: 0,
    signature: null,
    visibility: null,
    metadata: null,
    time_created: t,
    time_updated: t,
  }
}

function makeEdge(
  projectID: ProjectID,
  kind: "calls" | "references" | "imports",
  fromNode: CodeNodeID,
  toNode: CodeNodeID,
) {
  const t = now()
  return {
    id: CodeEdgeID.ascending(),
    project_id: projectID,
    kind,
    from_node: fromNode,
    to_node: toNode,
    file: "/tmp/file.ts",
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 1,
    range_end_char: 0,
    time_created: t,
    time_updated: t,
  }
}

describe("CodeGraphQuery edge kind planner", () => {
  test("edgesFrom and edgesTo use from/to indexes without ANALYZE", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeGraphQuery.clearProject(projectID)

        const caller = makeNode(projectID, "caller")
        const callee = makeNode(projectID, "callee")
        const other = makeNode(projectID, "other")
        CodeGraphQuery.insertNodes([caller, callee, other])
        CodeGraphQuery.insertEdges([
          makeEdge(projectID, "calls", caller.id, callee.id),
          makeEdge(projectID, "references", caller.id, other.id),
          makeEdge(projectID, "calls", other.id, callee.id),
          // Filler edges of another kind so the kind index would scan the
          // project if the planner picked it (the pre-fix behaviour).
          ...Array.from({ length: 40 }, () => makeEdge(projectID, "imports", caller.id, other.id)),
        ])

        // Results are unchanged by the unary-plus kind predicate.
        expect(CodeGraphQuery.edgesFrom(projectID, caller.id, "calls").map((row) => row.to_node)).toEqual([callee.id])
        expect(
          CodeGraphQuery.edgesTo(projectID, callee.id, "calls")
            .map((row) => row.from_node)
            .sort(),
        ).toEqual([caller.id, other.id].sort())
        expect(CodeGraphQuery.edgesFrom(projectID, caller.id).length).toBe(42)

        const raw = Database.Client().$client
        // No ANALYZE has run in this file's fresh database.
        expect(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'sqlite_stat1'").all()).toEqual([])

        const generated = Database.use((db) => ({
          from: db
            .select()
            .from(CodeEdgeTable)
            .where(
              and(
                eq(CodeEdgeTable.project_id, projectID),
                eq(CodeEdgeTable.from_node, caller.id),
                sql`+${CodeEdgeTable.kind} = ${"calls"}`,
              ),
            )
            .toSQL(),
          to: db
            .select()
            .from(CodeEdgeTable)
            .where(
              and(
                eq(CodeEdgeTable.project_id, projectID),
                eq(CodeEdgeTable.to_node, callee.id),
                sql`+${CodeEdgeTable.kind} = ${"calls"}`,
              ),
            )
            .toSQL(),
        }))

        // Drizzle renders the column reference with the unary plus intact.
        expect(generated.from.sql).toContain(`+"code_edge"."kind" = ?`)
        expect(generated.to.sql).toContain(`+"code_edge"."kind" = ?`)

        const explain = (query: { sql: string; params: unknown[] }) =>
          (raw.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...(query.params as string[])) as { detail: string }[])
            .map((row) => row.detail)
            .join("\n")

        const fromPlan = explain(generated.from)
        expect(fromPlan).toContain("code_edge_from_idx")
        expect(fromPlan).not.toContain("code_edge_project_kind_idx")

        const toPlan = explain(generated.to)
        expect(toPlan).toContain("code_edge_to_idx")
        expect(toPlan).not.toContain("code_edge_project_kind_idx")

        CodeGraphQuery.clearProject(projectID)
      },
    })
  })
})
