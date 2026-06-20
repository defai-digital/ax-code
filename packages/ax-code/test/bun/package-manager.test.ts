import { describe, expect, test } from "vitest"
import { NpmManager, packageManagerKind } from "../../src/bun/package-manager"
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
