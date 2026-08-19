import { describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeFileID } from "../../src/code-intelligence/id"
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

describe("CodeIntelligence symbol signals (ADR-056 Phase 3)", () => {
  test("recordSignal upserts hit_count and topWarmupFiles ranks by weight", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        CodeIntelligence.recordSignal(projectID, { qualifiedName: "a::f", file: "/tmp/a.ts", signalType: "bug" })
        CodeIntelligence.recordSignal(projectID, { qualifiedName: "a::f", file: "/tmp/a.ts", signalType: "bug" })
        CodeIntelligence.recordSignal(projectID, { qualifiedName: "b::g", file: "/tmp/b.ts", signalType: "note" })

        const signals = CodeGraphQuery.recentSignals(projectID)
        expect(signals).toHaveLength(2)
        const a = signals.find((s) => s.file === "/tmp/a.ts")
        expect(a?.hit_count).toBe(2)

        const files = CodeIntelligence.topWarmupFiles(projectID, { limit: 10 })
        expect(files[0].file).toBe("/tmp/a.ts") // bug(3) * 2 > note(1) * 1
        expect(files[0].score).toBeGreaterThan(files[1].score)
      },
    })
  })

  test("prunes old signals", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)

        CodeGraphQuery.upsertSignal(projectID, { qualifiedName: "old", file: "/tmp/old.ts", signalType: "note" }, 1)
        CodeGraphQuery.upsertSignal(
          projectID,
          { qualifiedName: "new", file: "/tmp/new.ts", signalType: "note" },
          Date.now(),
        )

        const removed = CodeGraphQuery.pruneSignals(projectID, Date.now() - 1000)
        expect(removed).toBe(1)
        expect(CodeGraphQuery.recentSignals(projectID)).toHaveLength(1)
      },
    })
  })
})

describe("CodeIntelligence note cap partitioning + rename re-anchoring (ADR-056)", () => {
  test("auto notes evict auto first; explicit notes survive", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        seedFile(projectID, "/tmp/a.ts", "sha-1")

        for (let i = 0; i < 3; i++) {
          CodeIntelligence.recordNote(projectID, {
            qualifiedName: "q",
            file: "/tmp/a.ts",
            kind: "hypothesis",
            body: `auto-${i}`,
            origin: "auto",
          })
        }
        for (let i = 0; i < 3; i++) {
          CodeIntelligence.recordNote(projectID, {
            qualifiedName: "q",
            file: "/tmp/a.ts",
            kind: "fact",
            body: `explicit-${i}`,
            origin: "explicit",
          })
        }

        const notes = CodeIntelligence.notesForSymbol(projectID, "q")
        expect(notes).toHaveLength(5)
        expect(notes.filter((n) => n.origin === "auto")).toHaveLength(2)
        expect(notes.filter((n) => n.origin === "explicit")).toHaveLength(3)
      },
    })
  })

  test("re-anchors a note after rename via (name, kind, signature)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        seedFile(projectID, "/tmp/old.ts", "sha-1")

        CodeIntelligence.recordNote(projectID, {
          qualifiedName: "old/foo.ts::handle",
          file: "/tmp/old.ts",
          kind: "fact",
          body: "moved elsewhere",
          symbolNameAtWrite: "handle",
          symbolKindAtWrite: "function",
          signatureAtWrite: "(a: number) => void",
        })

        // Exact anchor now misses (the symbol moved to a new qualified name).
        expect(CodeIntelligence.notesForSymbol(projectID, "new/foo.ts::handle")).toHaveLength(0)

        // With the current symbol identity, the old note re-anchors.
        const notes = CodeIntelligence.notesForSymbol(projectID, "new/foo.ts::handle", {
          current: { name: "handle", kind: "function", signature: "(a: number) => void" },
        })
        expect(notes).toHaveLength(1)
        expect(notes[0].explain.reanchoredFrom).toBe("old/foo.ts::handle")
      },
    })
  })
})
