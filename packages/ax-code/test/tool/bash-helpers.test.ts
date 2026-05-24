import { describe, expect, test } from "bun:test"
import {
  absolutePathLiterals,
  assertStaticRedirectTarget,
  hasDynamicRedirection,
  hasDynamicShellExpansion,
  isStaticPathArg,
  staticallyCheckablePathArgs,
  stripShellQuotes,
  truncateBashMetadata,
} from "../../src/tool/bash-helpers"

describe("tool.bash helpers", () => {
  test("detects dynamic shell expansion", () => {
    expect(hasDynamicShellExpansion("plain.txt")).toBe(false)
    expect(hasDynamicShellExpansion("$(pwd)/out.txt")).toBe(true)
    expect(hasDynamicShellExpansion("${HOME}/out.txt")).toBe(true)
    expect(hasDynamicShellExpansion("`pwd`/out.txt")).toBe(true)
  })

  test("rejects dynamic redirection targets", () => {
    expect(() => assertStaticRedirectTarget("out.txt")).not.toThrow()
    expect(() => assertStaticRedirectTarget("$(pwd)/out.txt")).toThrow(/Dynamic redirection targets/)
  })

  test("strips simple shell quotes for static path checks", () => {
    expect(stripShellQuotes('"file name.txt"')).toBe("file name.txt")
    expect(stripShellQuotes("'file name.txt'")).toBe("file name.txt")
    expect(stripShellQuotes("file.txt")).toBe("file.txt")
  })

  test("returns undefined for empty or dynamic path args", () => {
    expect(isStaticPathArg("'file name.txt'")).toBe("file name.txt")
    expect(isStaticPathArg("")).toBeUndefined()
    expect(isStaticPathArg("$(pwd)/file.txt")).toBeUndefined()
  })

  test("selects read-side path args for statically checkable commands", () => {
    expect(staticallyCheckablePathArgs("cd", ["one", "two"])).toEqual(["one"])
    expect(staticallyCheckablePathArgs("cat", ["a.txt", "b.txt"])).toEqual(["a.txt", "b.txt"])
    expect(staticallyCheckablePathArgs("cat", ["-n", "file.txt", "--", "-literal"])).toEqual(["file.txt", "-literal"])
    expect(staticallyCheckablePathArgs("mv", ["source.txt", "dest.txt"])).toEqual(["source.txt"])
    expect(staticallyCheckablePathArgs("cp", ["source.txt", "dest.txt"])).toEqual(["source.txt"])
  })

  test("skips force remove path checks", () => {
    expect(staticallyCheckablePathArgs("rm", ["missing.txt"])).toEqual(["missing.txt"])
    expect(staticallyCheckablePathArgs("rm", ["-f", "missing.txt"])).toEqual([])
    expect(staticallyCheckablePathArgs("rm", ["-rf", "missing-dir"])).toEqual([])
    expect(staticallyCheckablePathArgs("rm", ["--force", "missing.txt"])).toEqual([])
    expect(staticallyCheckablePathArgs("rm", ["--", "-f"])).toEqual(["-f"])
  })

  test("detects dynamic redirection commands", () => {
    expect(hasDynamicRedirection("echo ok > out.txt")).toBe(false)
    expect(hasDynamicRedirection("echo ok > $(pwd)/out.txt")).toBe(true)
    expect(hasDynamicRedirection("echo ok 2>> ${LOG_FILE}")).toBe(true)
  })

  test("extracts quoted absolute path literals", () => {
    expect(absolutePathLiterals(`cat "/tmp/a file.txt" '/var/log/app.log' relative.txt`)).toEqual([
      "/tmp/a file.txt",
      "/var/log/app.log",
    ])
  })

  test("truncates metadata by UTF-8 byte length without splitting characters", () => {
    const result = truncateBashMetadata("你你", 5)

    expect(result).toBe("你\n\n...")
    expect(result).not.toContain("\uFFFD")
  })
})
