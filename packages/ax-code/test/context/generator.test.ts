import { describe, expect, test } from "vitest"
import type { ProjectInfo } from "../../src/context"
import { generate } from "../../src/context/generator"

const baseInfo: ProjectInfo = {
  schemaVersion: "2.0",
  name: "sample",
  version: "1.0.0",
  description: "Sample project",
  primaryLanguage: "TypeScript",
  techStack: ["TypeScript", "Bun"],
  projectType: "cli",
  entryPoint: "src/index.ts",
  complexity: {
    level: "medium",
    score: 20,
    fileCount: 10,
    linesOfCode: 500,
    dependencyCount: 4,
  },
  directories: {
    source: "src",
    tests: "test",
  },
  keyFiles: {
    "package.json": "Package manifest",
    "tsconfig.json": "TypeScript config",
  },
  conventions: {
    moduleSystem: "esm",
    importExtension: ".js",
    testFramework: "bun:test",
    validation: "zod",
    strict: true,
  },
  scripts: {
    build: "bun run build",
    test: "bun test",
    typecheck: "tsgo --noEmit",
  },
  packageManager: "pnpm",
  lastAnalyzed: "2026-05-23T00:00:00.000Z",
  gotchas: [],
  runtimeTargets: ["bun"],
}

describe("context generator", () => {
  test("includes agent quality guidance in generated AGENTS.md", () => {
    const content = generate(baseInfo, { depth: "standard" })

    expect(content).toContain("## Agent Quality Loop")
    expect(content).toContain("State non-obvious assumptions before changing code")
    expect(content).toContain("smallest scoped change")
    expect(content).toContain("Verify with the narrowest relevant test")
  })

  test("includes knowledge routing for AX Wiki vs index", () => {
    const content = generate(baseInfo, { depth: "standard" })
    expect(content).toContain("## Knowledge routing")
    expect(content).toContain("ax-wiki/")
    expect(content).toContain("code_intelligence")
    expect(content).toContain("ax-code wiki")
  })

  test("includes MCP suggestions section when suggestedMcp is set", () => {
    const info: ProjectInfo = { ...baseInfo, suggestedMcp: ["@playwright/mcp — browser screenshot"] }
    const content = generate(info)
    expect(content).toContain("## Suggested MCP Servers")
    expect(content).toContain("@playwright/mcp")
    expect(content).toContain("ax-code mcp --discover")
  })

  test("omits MCP suggestions section when suggestedMcp is absent", () => {
    const content = generate(baseInfo)
    expect(content).not.toContain("## Suggested MCP Servers")
  })
})
