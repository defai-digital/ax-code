import { describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID, CodeFileID } from "../../src/code-intelligence/id"
import { GraphContext } from "../../src/code-intelligence/graph-context"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

function seedFile(projectID: ProjectID, file: string, sha: string) {
  const t = Date.now()
  CodeGraphQuery.upsertFile({
    id: CodeFileID.ascending(),
    project_id: projectID,
    path: file,
    sha,
    size: 100,
    lang: "typescript",
    indexed_at: t,
    completeness: "full",
    time_created: t,
    time_updated: t,
  })
}

function seedSymbol(projectID: ProjectID, name: string, file: string) {
  const t = Date.now()
  CodeGraphQuery.insertNode({
    id: CodeNodeID.ascending(),
    project_id: projectID,
    kind: "function",
    name,
    qualified_name: name,
    file,
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 1,
    range_end_char: 0,
    signature: null,
    visibility: null,
    metadata: null,
    time_created: t,
    time_updated: t,
  })
}

describe("CodeIntelligence symbol notes (ADR-056)", () => {
  test("records and reads a note back fresh", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        seedFile(projectID, "/tmp/a.ts", "sha-1")

        const note = CodeIntelligence.recordNote(projectID, {
          qualifiedName: "src/a.ts::foo",
          file: "/tmp/a.ts",
          kind: "fact",
          body: "  foo is the choke point  ",
          sessionId: "sess-1",
        })

        expect(note.body).toBe("foo is the choke point")
        expect(note.freshness).toBe("fresh")
        expect(note.explain.source).toBe("session-note")
        expect(note.sessionId).toBe("sess-1")

        const read = CodeIntelligence.notesForSymbol(projectID, "src/a.ts::foo")
        expect(read).toHaveLength(1)
        expect(read[0].id).toBe(note.id)
      },
    })
  })

  test("marks a note stale on hash change and orphaned when the file is gone", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        seedFile(projectID, "/tmp/a.ts", "sha-1")

        CodeIntelligence.recordNote(projectID, { qualifiedName: "q", file: "/tmp/a.ts", kind: "fact", body: "b1" })
        expect(CodeIntelligence.notesForSymbol(projectID, "q")[0].freshness).toBe("fresh")

        seedFile(projectID, "/tmp/a.ts", "sha-2")
        expect(CodeIntelligence.notesForSymbol(projectID, "q")[0].freshness).toBe("stale")

        CodeGraphQuery.deleteFile(projectID, "/tmp/a.ts")
        expect(CodeIntelligence.notesForSymbol(projectID, "q")[0].freshness).toBe("orphaned")
      },
    })
  })

  test("dedupes identical notes and caps at 5 per symbol", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        seedFile(projectID, "/tmp/a.ts", "sha-1")

        const first = CodeIntelligence.recordNote(projectID, {
          qualifiedName: "q",
          file: "/tmp/a.ts",
          kind: "fact",
          body: "same",
        })
        const dup = CodeIntelligence.recordNote(projectID, {
          qualifiedName: "q",
          file: "/tmp/a.ts",
          kind: "fact",
          body: "  same ",
        })
        expect(dup.id).toBe(first.id)
        expect(CodeIntelligence.notesForSymbol(projectID, "q")).toHaveLength(1)

        for (let i = 0; i < 6; i++) {
          CodeIntelligence.recordNote(projectID, {
            qualifiedName: "q",
            file: "/tmp/a.ts",
            kind: "caveat",
            body: `note-${i}`,
          })
        }
        expect(CodeIntelligence.notesForSymbol(projectID, "q")).toHaveLength(5)
      },
    })
  })

  test("clearProject clears notes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        seedFile(projectID, "/tmp/a.ts", "sha-1")
        CodeIntelligence.recordNote(projectID, { qualifiedName: "q", file: "/tmp/a.ts", kind: "fact", body: "b1" })
        expect(CodeIntelligence.notesForSymbol(projectID, "q")).toHaveLength(1)

        CodeIntelligence.__clearProject(projectID)
        expect(CodeIntelligence.notesForSymbol(projectID, "q")).toHaveLength(0)
      },
    })
  })

  test("graph-context surfaces prior session notes in a distinct section", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        seedSymbol(projectID, "handleRequest", "/tmp/seed.ts")
        seedFile(projectID, "/tmp/seed.ts", "sha-1")
        CodeIntelligence.recordNote(projectID, {
          qualifiedName: "handleRequest",
          file: "/tmp/seed.ts",
          kind: "fact",
          body: "prior finding: this handler is the auth entrypoint",
        })

        const pack = await GraphContext.build(projectID, { query: "handleRequest", scope: "none" })
        expect(pack.notes).toHaveLength(1)
        expect(pack.output).toContain("## Prior Session Notes")
        expect(pack.output).toContain("prior finding")
      },
    })
  })
})
