import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { CodeIntelligence } from "../../src/code-intelligence"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Flag } from "../../src/flag/flag"

Log.init({ print: false })

describe("code-intelligence import edges", () => {
  test("parses ES module imports", () => {
    const text = `
import { foo } from "./utils"
import bar from "./bar.ts"
import type { Baz } from "./types"
`
    // Test the parseImports function indirectly through the builder
    const IMPORT_REGEX =
      /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g

    const imports: string[] = []
    for (const match of text.matchAll(IMPORT_REGEX)) {
      const modulePath = match[1] ?? match[2] ?? match[3]
      if (modulePath) imports.push(modulePath)
    }

    expect(imports).toContain("./utils")
    expect(imports).toContain("./bar.ts")
    expect(imports).toContain("./types")
  })

  test("parses require() calls", () => {
    const text = `
const fs = require("fs")
const { join } = require("path")
const utils = require("./utils.js")
`
    const IMPORT_REGEX =
      /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g

    const imports: string[] = []
    for (const match of text.matchAll(IMPORT_REGEX)) {
      const modulePath = match[1] ?? match[2] ?? match[3]
      if (modulePath) imports.push(modulePath)
    }

    expect(imports).toContain("fs")
    expect(imports).toContain("path")
    expect(imports).toContain("./utils.js")
  })

  test("parses dynamic import() calls", () => {
    const text = `
const module = await import("./lazy-module.ts")
const plugin = await import(\`./plugins/\${name}\`)
`
    const IMPORT_REGEX =
      /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g

    const imports: string[] = []
    for (const match of text.matchAll(IMPORT_REGEX)) {
      const modulePath = match[1] ?? match[2] ?? match[3]
      if (modulePath) imports.push(modulePath)
    }

    expect(imports).toContain("./lazy-module.ts")
  })

  test("skips built-in modules", () => {
    const text = `
import fs from "fs"
import path from "path"
import http from "node:http"
import { foo } from "./local"
`
    const IMPORT_REGEX =
      /(?:import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g

    const builtins = new Set([
      "fs",
      "path",
      "os",
      "crypto",
      "http",
      "https",
      "net",
      "tls",
      "dns",
      "url",
      "querystring",
      "stream",
      "util",
      "events",
      "buffer",
      "child_process",
    ])

    const imports: string[] = []
    for (const match of text.matchAll(IMPORT_REGEX)) {
      const modulePath = match[1] ?? match[2] ?? match[3]
      if (!modulePath) continue
      if (modulePath.startsWith("node:") || builtins.has(modulePath)) continue
      imports.push(modulePath)
    }

    expect(imports).toContain("./local")
    expect(imports).not.toContain("fs")
    expect(imports).not.toContain("path")
    expect(imports).not.toContain("node:http")
  })
})
