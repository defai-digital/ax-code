import { describe, expect, test } from "vitest"
import { NpmManager, packageManagerKind, toolRunner } from "../../src/bun/package-manager"
import type { RuntimeMode } from "../../src/installation/runtime-mode"

describe("packageManagerKind", () => {
  test("drives npm only on the node-bundled runtime", () => {
    expect(packageManagerKind("node-bundled")).toBe("npm")
  })

  test("drives bun on every Bun runtime mode", () => {
    const bunModes: RuntimeMode[] = ["compiled", "source", "bun-bundled", "unknown"]
    for (const mode of bunModes) {
      expect(packageManagerKind(mode)).toBe("bun")
    }
  })
})

describe("NpmManager command shapes", () => {
  test("addArgs pins an exact version into the cache prefix", () => {
    expect(NpmManager.addArgs("@ai-sdk/openai", "1.2.3", "/tmp/cache")).toEqual([
      "install",
      "--save-exact",
      "--prefix",
      "/tmp/cache",
      "@ai-sdk/openai@1.2.3",
    ])
  })

  test("installArgs targets the dependency dir via --prefix", () => {
    expect(NpmManager.installArgs("/plugins/foo")).toEqual(["install", "--prefix", "/plugins/foo"])
  })

  test("infoArgs reads a single registry field with npm view", () => {
    expect(NpmManager.infoArgs("lodash", "version")).toEqual(["view", "lodash", "version"])
  })

  test("never hardcodes a registry override", () => {
    const all = [
      ...NpmManager.addArgs("p", "1.0.0", "/c"),
      ...NpmManager.installArgs("/c"),
      ...NpmManager.infoArgs("p", "version"),
    ]
    expect(all.some((a) => a.startsWith("--registry"))).toBe(false)
  })
})

describe("toolRunner", () => {
  test("uses `bun x` with BUN_BE_BUN on a Bun runtime", () => {
    const runner = toolRunner({ bunExecutable: "/opt/homebrew/bin/bun", kind: "bun" })
    expect(runner.command).toEqual(["/opt/homebrew/bin/bun", "x"])
    expect(runner.environment).toEqual({ BUN_BE_BUN: "1" })
  })

  test("uses `npx --yes` with no special env on the Node runtime", () => {
    const runner = toolRunner({ bunExecutable: "/usr/local/bin/node", kind: "npm" })
    expect(runner.command).toEqual(["npx", "--yes"])
    expect(runner.environment).toBeUndefined()
  })

  test("composes into a full tool invocation", () => {
    const runner = toolRunner({ bunExecutable: "node", kind: "npm" })
    expect([...runner.command, "prettier", "--write", "$FILE"]).toEqual([
      "npx",
      "--yes",
      "prettier",
      "--write",
      "$FILE",
    ])
  })
})
