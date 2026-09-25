import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { MUTATION_TOOLS, REGISTERED_MUTATION_TOOLS } from "../../src/tool/mutation-tools"

/**
 * Drift guard for the mutation classification (ADR-142).
 *
 * The set is hand-kept, so a new tool that writes files could silently escape
 * the goal completion gate — the exact defect ADR-142 fixed. Instead of trusting
 * a declaration, this test derives the writer set **from the source**: any tool
 * definition whose file reaches a workspace write path must be classified, and
 * every classified registered tool must show such a path or be listed here as a
 * documented delegation.
 *
 * Deriving from the source rather than from a `Tool.define({ mutates: true })`
 * flag was deliberate: `Tool.define` returns only `{ id, init }`, so a field on
 * an object-form definition is not readable from the returned `Info`; the
 * registry that could expose it is Instance-scoped, async and config-filtered;
 * and `mutation-tools.ts` is a leaf that must not start importing tool
 * definitions.
 */

const TOOL_DIR = path.resolve(import.meta.dirname, "../../src/tool")

/** Calls that mean "this code path writes the workspace". */
const WRITE_MARKERS: ReadonlyArray<RegExp> = [
  /recordWriteAndAssert/,
  /fs\.writeFile(?:Sync)?\(/,
  /Filesystem\.write/,
]

/**
 * Ids that are classified although no local write marker exists, because the
 * write happens behind a helper this scan cannot follow. Each entry states where
 * the write actually lives.
 */
const INDIRECT_WRITERS: Readonly<Record<string, string>> = {
  refactor_apply: "writes through DebugEngine.applySafeRefactor; the tool module holds no write call",
}

/**
 * Writers that are deliberately not mutations. `bash` is the gate's own
 * verification tool: counting it as a mutation would make "verification after
 * the last change" unsatisfiable, because the verification run would itself be
 * the last mutation.
 */
const DELIBERATE_EXCLUSIONS: Readonly<Record<string, string>> = {
  bash: "the gate's verification tool; see ADR-142's recorded limitation",
}

function toolSourceFiles(): string[] {
  return readdirSync(TOOL_DIR, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => path.join(TOOL_DIR, entry))
}

function definedToolIds(source: string): string[] {
  return [...source.matchAll(/Tool\.define\(\s*"([a-z0-9_]+)"/g)].map((match) => match[1]!)
}

describe("mutation tool classification drift guard", () => {
  test("every tool file that writes the workspace is classified", () => {
    const writers = new Map<string, string>()
    for (const file of toolSourceFiles()) {
      const source = readFileSync(file, "utf8")
      if (!WRITE_MARKERS.some((marker) => marker.test(source))) continue
      for (const id of definedToolIds(source)) writers.set(id, path.relative(TOOL_DIR, file))
    }

    const unclassified = [...writers.entries()].filter(
      ([id]) => !MUTATION_TOOLS.has(id) && DELIBERATE_EXCLUSIONS[id] === undefined,
    )
    expect(unclassified).toEqual([])
    // The scan must keep finding the writers it is supposed to protect, or a
    // path/extension change would silently disable this guard.
    expect([...writers.keys()].toSorted()).toEqual([
      "apply_patch",
      "bash",
      "edit",
      "image_gen",
      "multiedit",
      "notebook_edit",
      "write",
    ])
  })

  test("every classified registered tool is a declared writer or a documented delegation", () => {
    const declared = new Set<string>()
    for (const file of toolSourceFiles()) {
      const source = readFileSync(file, "utf8")
      if (!WRITE_MARKERS.some((marker) => marker.test(source))) continue
      for (const id of definedToolIds(source)) declared.add(id)
    }

    const unexplained = REGISTERED_MUTATION_TOOLS.filter(
      (id) => !declared.has(id) && INDIRECT_WRITERS[id] === undefined,
    )
    expect(unexplained).toEqual([])
  })

  test("the exclusion and delegation lists stay honest", () => {
    // An exclusion that no longer writes anything is a stale claim, and a
    // delegation entry that now has a local write marker should be folded back.
    for (const id of Object.keys(DELIBERATE_EXCLUSIONS)) expect(MUTATION_TOOLS.has(id)).toBe(false)
    for (const id of Object.keys(INDIRECT_WRITERS)) expect(REGISTERED_MUTATION_TOOLS).toContain(id)
  })
})
