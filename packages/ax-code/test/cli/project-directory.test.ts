import { expect, test } from "vitest"
import path from "node:path"
import { writeFile } from "node:fs/promises"
import { projectDirectory } from "../../src/cli/project-directory"
import { tmpdir } from "../fixture/fixture"

test("project selectors reject empty, absent and non-directory targets", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "file.txt")
  await writeFile(file, "test")
  for (const dir of ["", " ", file, path.join(tmp.path, "missing"), []]) {
    expect(() => projectDirectory({ dir })).toThrow(/--dir must name an (?:accessible )?existing directory/)
  }
  expect(projectDirectory({})).toBe(process.cwd())
  expect(projectDirectory({ dir: path.relative(process.cwd(), tmp.path) })).toBe(tmp.path)
})
