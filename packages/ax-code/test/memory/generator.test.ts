import { describe, expect, test } from "vitest"
import path from "path"
import fs from "fs/promises"
import { decodeMemoryPackageJsonValue, generate, parseMemoryPackageJson } from "../../src/memory/generator"
import { tmpdir } from "../fixture/fixture"

describe("memory.generator", () => {
  test("decodeMemoryPackageJsonValue decodes already-parsed package metadata safely", () => {
    expect(
      decodeMemoryPackageJsonValue({
        name: "pkg",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit", lint: true },
        dependencies: { react: "^19.0.0" },
        devDependencies: { vitest: "^3.0.0" },
      }),
    ).toEqual({
      name: "pkg",
      version: "1.0.0",
      scripts: ["typecheck"],
      dependencies: ["react"],
      devDependencies: ["vitest"],
      allDependencies: ["react", "vitest"],
    })

    expect(decodeMemoryPackageJsonValue(null)).toEqual({
      scripts: [],
      dependencies: [],
      devDependencies: [],
      allDependencies: [],
    })
  })

  test("parseMemoryPackageJson decodes package metadata safely", () => {
    expect(
      parseMemoryPackageJson(
        JSON.stringify({
          name: "pkg",
          version: "1.0.0",
          scripts: { typecheck: "tsc --noEmit", lint: true },
          dependencies: { react: "^19.0.0" },
          devDependencies: { vitest: "^3.0.0" },
        }),
      ),
    ).toEqual({
      name: "pkg",
      version: "1.0.0",
      scripts: ["typecheck"],
      dependencies: ["react"],
      devDependencies: ["vitest"],
      allDependencies: ["react", "vitest"],
    })

    expect(parseMemoryPackageJson(JSON.stringify(null))).toEqual({
      scripts: [],
      dependencies: [],
      devDependencies: [],
      allDependencies: [],
    })
    expect(parseMemoryPackageJson(JSON.stringify({ scripts: [] }))).toEqual({
      scripts: [],
      dependencies: [],
      devDependencies: [],
      allDependencies: [],
    })
    expect(() => parseMemoryPackageJson("{not json")).toThrow(SyntaxError)
  })

  test("generate uses decoded package metadata for config and patterns", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        scripts: { typecheck: "tsc --noEmit", test: false },
        dependencies: { react: "^19.0.0" },
        devDependencies: { vitest: "^3.0.0" },
      }),
    )

    const memory = await generate(tmp.path, { maxTokens: 4000 })

    expect(memory.sections.config?.content).toContain("Name: pkg")
    expect(memory.sections.config?.content).toContain("Version: 1.0.0")
    expect(memory.sections.config?.content).toContain("Scripts: typecheck")
    expect(memory.sections.config?.content).toContain("Dependencies: 1 packages")
    expect(memory.sections.patterns?.content).toContain("Framework: React")
    expect(memory.sections.patterns?.content).toContain("Testing: configured")
  })
})
