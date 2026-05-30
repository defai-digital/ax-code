import { expect, mock, test } from "bun:test"

const nativeEdges = [
  {
    id: "ced_native",
    project_id: "proj_native",
    kind: "imports",
    from_node: "cnd_from",
    to_node: "cnd_to",
    file: "/tmp/source.ts",
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 0,
    range_end_char: 10,
    time_created: 1,
    time_updated: 1,
  },
]

const edgesInFile = mock(() => nativeEdges)
const deleteEdgesInFile = mock(() => undefined)
const close = mock(() => undefined)
const parseNativeStoreJson = mock((json: string, fallback: unknown) => {
  try {
    return JSON.parse(json)
  } catch {
    return fallback
  }
})

mock.module("../../src/code-intelligence/native-store", () => ({
  NativeStore: {
    available: true,
    close,
    edgesInFile,
    deleteEdgesInFile,
    parseNativeStoreJson,
  },
}))

process.env["AX_CODE_NATIVE_INDEX"] = "1"
const queryModule = "../../src/code-intelligence/query.ts" + "?native-dispatch"
const { CodeGraphQuery } = await import(queryModule)
process.env["AX_CODE_NATIVE_INDEX"] = "0"

test("CodeGraphQuery dispatches file edge APIs to the native index store", () => {
  expect(CodeGraphQuery.edgesInFile("proj_native" as any, "/tmp/source.ts")).toBe(nativeEdges)
  expect(edgesInFile).toHaveBeenCalledWith("proj_native", "/tmp/source.ts")

  CodeGraphQuery.deleteEdgesInFile("proj_native" as any, "/tmp/source.ts")
  expect(deleteEdgesInFile).toHaveBeenCalledWith("proj_native", "/tmp/source.ts")
})
