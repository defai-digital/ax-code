import { describe, expect, test } from "bun:test"
import { decodeAnalyzerPackageJsonValue, parseAnalyzerPackageJsonText } from "../../src/context/analyzer"

describe("context analyzer package JSON decoding", () => {
  test("decodes package JSON values into analyzer fields", () => {
    expect(
      decodeAnalyzerPackageJsonValue({
        name: "app",
        version: "1.2.3",
        type: "module",
        description: "Demo",
        main: "dist/index.js",
        bin: { app: "bin/app.js", broken: 1 },
        scripts: { build: "tsc", invalid: false },
        dependencies: { react: "latest", invalid: 1 },
        devDependencies: { vitest: "latest" },
        exports: { ".": "./dist/index.js" },
        packageManager: "pnpm@10.33.4",
      }),
    ).toEqual({
      name: "app",
      version: "1.2.3",
      type: "module",
      description: "Demo",
      main: "dist/index.js",
      bin: { app: "bin/app.js" },
      scripts: { build: "tsc" },
      dependencies: { react: "latest" },
      devDependencies: { vitest: "latest" },
      exports: { ".": "./dist/index.js" },
      packageManager: "pnpm@10.33.4",
    })
  })

  test("drops malformed package JSON fields instead of preserving casts", () => {
    expect(
      decodeAnalyzerPackageJsonValue({
        name: 1,
        bin: {},
        scripts: [],
        dependencies: null,
        devDependencies: { vitest: true },
        packageManager: false,
      }),
    ).toEqual({})
  })

  test("parses package JSON text before analyzer value decoding", () => {
    expect(parseAnalyzerPackageJsonText(JSON.stringify({ name: "app", scripts: { test: "bun test" } }))).toEqual({
      name: "app",
      scripts: { test: "bun test" },
    })
    expect(() => parseAnalyzerPackageJsonText("{not json")).toThrow(SyntaxError)
  })
})
