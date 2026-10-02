import { describe, expect, test } from "vitest"
import {
  checkBoundary,
  checkExportDeclaration,
  checkExportLists,
  escapesSrc,
  scanLine,
  scanSpecifiers,
  stripComments,
  stripToCode,
} from "./check-agent-runtime-boundary"

describe("stripToCode", () => {
  test("blanks strings containing comment markers without blinding later lines", () => {
    const stripped = stripToCode(`const glob = "src/*.ts"\nimport x from "@/session"\n`)
    expect(stripped).toContain("import x from")
    expect(stripped).not.toContain("src/*.ts")
    expect(stripped).not.toContain("@/session")
  })

  test("stripComments keeps strings verbatim and drops comments", () => {
    const stripped = stripComments(`const glob = "src/*.ts"\nimport x from "@/session" // trailing\n`)
    expect(stripped).toContain(`import x from "@/session"`)
    expect(stripped).not.toContain("trailing")
  })

  test("removes line and block comments but keeps line numbers", () => {
    const input = `const a = 1 // Date.now()\n/* SessionID\nspans lines */\nconst b = 2\n`
    const stripped = stripToCode(input)
    expect(stripped.split("\n")).toHaveLength(input.split("\n").length)
    expect(stripped).not.toContain("Date.now()")
    expect(stripped).not.toContain("SessionID")
    expect(stripped).toContain("const b = 2")
  })

  test("keeps template interpolation code, blanks static parts", () => {
    const stripped = stripToCode("const m = `hi ${Date.now()} // not a comment`\n")
    expect(stripped).toContain("Date.now()")
    expect(stripped).not.toContain("not a comment")
  })
})

describe("scanSpecifiers", () => {
  const specs = (code: string) => scanSpecifiers(stripComments(code), code).map((found) => found.specifier)

  test("finds static, side-effect, and spacing variants", () => {
    expect(specs(`import x from "hono"`)).toEqual(["hono"])
    expect(specs(`import "hono"`)).toEqual(["hono"])
    expect(specs(`import x from"hono"`)).toEqual(["hono"])
    expect(specs(`export { x } from "./y"`)).toEqual(["./y"])
    expect(specs(`import type { X } from "./decision"`)).toEqual(["./decision"])
  })

  test("finds dynamic, require, multiline, and reference forms", () => {
    expect(specs("const m = await import(`hono`)")).toEqual(["hono"])
    expect(specs(`const m = require("hono")`)).toEqual(["hono"])
    expect(specs(`import {\na} from\n"./y"`)).toEqual(["./y"])
    expect(specs(`/// <reference path="../../ax-code/src/x" />`)).toEqual(["../../ax-code/src/x"])
  })

  test("ignores specifiers inside strings and comments", () => {
    expect(specs(`const s = "from \\"hono\\""`)).toEqual([])
    expect(specs(`// import x from "hono"`)).toEqual([])
  })

  test("reports line numbers", () => {
    const input = `const a = 1\nimport x from "hono"\n`
    const found = scanSpecifiers(stripComments(input), input)
    expect(found).toEqual([{ specifier: "hono", line: 2 }])
  })
})

describe("escapesSrc", () => {
  const src = "/repo/packages/ax-agent-runtime/src"
  test("sibling and nested relative imports stay contained", () => {
    expect(escapesSrc("./decision", `${src}/index.ts`, src)).toBe(false)
    expect(escapesSrc("../sibling", `${src}/nested/file.ts`, src)).toBe(false)
  })

  test("parent escapes are caught", () => {
    expect(escapesSrc("../package.json", `${src}/index.ts`, src)).toBe(true)
    expect(escapesSrc("./../../ax-code/src/x", `${src}/index.ts`, src)).toBe(true)
  })
})

describe("scanLine", () => {
  test("flags environment, timer, and domain tokens", () => {
    for (const line of [
      `const home = process.env.HOME`,
      `const env = process["env"]`,
      `cwd = process.cwd()`,
      `const now = Date.now()`,
      `const d = new Date()`,
      `const t = performance.now()`,
      `globalThis.setTimeout(f, 1)`,
      `queueMicrotask(f)`,
      `import fs from "node:fs"`,
      `const b = Bun.env.X`,
      `let id: SessionID`,
      `let id: MessageID`,
      `let id: PartID`,
      `setTimeout(() => {}, 1)`,
    ]) {
      expect(scanLine(line), line).not.toHaveLength(0)
    }
  })

  test("allows sibling, node, and plain code", () => {
    expect(scanLine(`import type { TurnDecision } from "./decision"`)).toHaveLength(0)
    expect(scanLine(`import path from "node:path"`)).toHaveLength(0)
    expect(scanLine(`const x = 1`)).toHaveLength(0)
  })

  test("flags executable policy declarations by allowlist, not by name", () => {
    expect(scanLine(`export async function tick() {}`)).not.toHaveLength(0)
    expect(scanLine(`export function decideTurn() {}`)).not.toHaveLength(0)
    expect(scanLine(`export function decideTurn<T>() {}`)).not.toHaveLength(0)
    expect(scanLine(`export const tick = async () => {}`)).not.toHaveLength(0)
    expect(scanLine(`export default async function () {}`)).not.toHaveLength(0)
    expect(scanLine(`export default {}`)).not.toHaveLength(0)
    expect(scanLine(`export * from "./x"`)).not.toHaveLength(0)
    expect(scanLine(`export class Engine {}`)).not.toHaveLength(0)
    expect(scanLine(`export function configureAgentRuntimeHost() {}`)).toHaveLength(0)
    expect(scanLine(`export function getAgentRuntimeHost() {}`)).toHaveLength(0)
    expect(scanLine(`export type { TurnDecision } from "./decision"`)).toHaveLength(0)
    expect(scanLine(`export interface Shape {}`)).toHaveLength(0)
    expect(scanLine(`export namespace TurnDecision {}`)).toHaveLength(0)
    expect(scanLine(`export { configureAgentRuntimeHost, getAgentRuntimeHost }`)).toHaveLength(0)
    expect(scanLine(`export { decideTurn }`)).not.toHaveLength(0)
  })
})

describe("checkExportDeclaration", () => {
  test("single-line export lists are checked per name", () => {
    expect(checkExportDeclaration(`export { configureAgentRuntimeHost }`)).toHaveLength(0)
    expect(checkExportDeclaration(`export { a as decideTurn }`)).not.toHaveLength(0)
    expect(checkExportDeclaration(`export { type Maybe }`)).toHaveLength(0)
  })
})

describe("checkExportLists", () => {
  test("multiline export lists are checked", () => {
    const findings = checkExportLists(stripToCode(`export {\nconfigureAgentRuntimeHost,\ndecideTurn,\n}\n`))
    expect(findings.map((finding) => finding.detail)).toHaveLength(1)
    expect(findings[0]?.line).toBe(1)
  })

  test("multiline export type lists are skipped", () => {
    expect(checkExportLists(stripToCode(`export type {\nTurnDecision,\n}\n`))).toHaveLength(0)
  })
})

describe("checkBoundary on the real tree", () => {
  test("reports no violations", async () => {
    await expect(checkBoundary()).resolves.toEqual([])
  })
})
