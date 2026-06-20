import { describe, expect, test } from "vitest"
import {
  absolutePathLiterals,
  assertStaticRedirectTarget,
  hasDynamicRedirection,
  hasDynamicShellExpansion,
  isStaticPathArg,
  refProcessIfAvailable,
  safeUtf8PrefixLength,
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

  test("does not treat shell variable references or globs as static paths", () => {
    // A bare variable reference (e.g. `cat $f` inside a `for f ...` loop) must not
    // be statically path-checked — it would resolve to a literal "$f" and trigger
    // a false "Path does not exist". Regression for the reported session error.
    expect(isStaticPathArg("$f")).toBeUndefined()
    expect(isStaticPathArg("ax-internal/prd/$f")).toBeUndefined()
    expect(isStaticPathArg('"$f"')).toBeUndefined()
    expect(isStaticPathArg("${file}")).toBeUndefined()
    // Globs and brace expansion are resolved by the shell, not statically.
    expect(isStaticPathArg("*.ts")).toBeUndefined()
    expect(isStaticPathArg("src/**/*.tsx")).toBeUndefined()
    expect(isStaticPathArg("ax-internal/prd/prd-*.md")).toBeUndefined()
    expect(isStaticPathArg("file?.txt")).toBeUndefined()
    expect(isStaticPathArg("{a,b}.txt")).toBeUndefined()
    expect(isStaticPathArg("~/notes.txt")).toBeUndefined()
    // Plain literal paths are still checkable.
    expect(isStaticPathArg("src/index.ts")).toBe("src/index.ts")
    expect(isStaticPathArg("ax-internal/prd/spec.md")).toBe("ax-internal/prd/spec.md")
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

  test("keeps a valid leading byte when checking the next UTF-8 byte would overrun", () => {
    const chunk = Buffer.from([0x61, 0x80])

    expect(safeUtf8PrefixLength(chunk, 1)).toBe(1)
  })

  test("drops a partial multibyte lead byte at the truncation boundary", () => {
    const chunk = Buffer.from("你", "utf8")

    expect(safeUtf8PrefixLength(chunk, 1)).toBe(0)
  })

  test("drops a partial multibyte lead byte when the stream chunk ends at the boundary", () => {
    const chunk = Buffer.from("你", "utf8").subarray(0, 1)

    expect(safeUtf8PrefixLength(chunk, 1)).toBe(0)
  })

  test("refs child processes only when the runtime exposes ref()", () => {
    let calls = 0

    expect(refProcessIfAvailable({ ref: () => calls++ })).toBe(true)
    expect(refProcessIfAvailable({})).toBe(false)
    expect(calls).toBe(1)
  })
})
