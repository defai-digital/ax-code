import { afterEach, describe, expect, test } from "vitest"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { Snapshot } from "../../src/snapshot"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

afterEach(() => Instance.disposeAll())

describe.skipIf(process.platform === "win32")("snapshot path fidelity", () => {
  test.each([
    { label: "leading spaces", filename: " leading.txt" },
    { label: "trailing spaces", filename: "trailing.txt " },
    { label: "a tab", filename: `tab${String.fromCharCode(9)}name.txt` },
    { label: "a newline", filename: `line${String.fromCharCode(10)}name.txt` },
    { label: "a bell", filename: `bell${String.fromCharCode(7)}name.txt` },
    { label: "a vertical tab", filename: `vertical${String.fromCharCode(11)}name.txt` },
  ])("preserves $label in diff and revert previews", async ({ filename }) => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = path.join(tmp.path, filename)
        await Filesystem.write(file, "before\n")
        const before = await Snapshot.track()
        await Filesystem.write(file, "after\n")
        const after = await Snapshot.track()

        const expected = [
          { file: filename, before: "before\n", after: "after\n", additions: 1, deletions: 1, status: "modified" },
        ]
        expect(await Snapshot.diffFull(before!, after!)).toEqual(expected)
        expect(await Snapshot.previewRevert([{ hash: before!, files: [file] }])).toEqual(expected)
      },
    })
  })
})
