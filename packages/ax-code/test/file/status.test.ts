import { expect, test } from "bun:test"
import { deletedFileStatus, parseDeletedPaths, parseModifiedNumstat, untrackedFileStatus } from "../../src/file/status"

test("parseModifiedNumstat returns modified entries with decoded paths", () => {
  expect(parseModifiedNumstat('2\t1\tsrc/index.ts\n-\t-\t"asset\\tname.png"')).toEqual([
    {
      path: "src/index.ts",
      added: 2,
      removed: 1,
      status: "modified",
    },
    {
      path: "asset\tname.png",
      added: 0,
      removed: 0,
      status: "modified",
    },
  ])
})

test("parseDeletedPaths decodes git path lines", () => {
  expect(parseDeletedPaths('src/old.ts\n"deleted\\tfile.ts"\n')).toEqual(["src/old.ts", "deleted\tfile.ts"])
})

test("untrackedFileStatus preserves existing line counting behavior", () => {
  expect(untrackedFileStatus("new.ts", "a\nb\n")).toEqual({
    path: "new.ts",
    added: 2,
    removed: 0,
    status: "added",
  })
  expect(untrackedFileStatus("new.ts", "")).toEqual({
    path: "new.ts",
    added: 1,
    removed: 0,
    status: "added",
  })
})

test("deletedFileStatus reads removed lines from numstat", () => {
  expect(deletedFileStatus("old.ts", "0\t3\told.ts\n")).toEqual({
    path: "old.ts",
    added: 0,
    removed: 3,
    status: "deleted",
  })
})
