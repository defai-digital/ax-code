import { expect, test } from "vitest"
import { execute } from "../../src/codemode/interpreter"

const limit = async (source: string) => {
  const result = await execute(source, { tools: [], dispatch: async () => null })
  return result.diagnostic as { error: string; limit?: string } | undefined
}

test.each([
  ['let s = ""; for (let i = 0; i < 200000; i++) s += "x"; s.length', "heap_units"],
  ['let s = "xxxxxxxx"; for (let i = 0; i < 40; i++) s += s; s.length', "string_bytes"],
  ['let s = "x"; for (let i = 0; i < 40; i++) s = s + s; s.length', "string_bytes"],
  ['let s = "x"; for (let i = 0; i < 40; i++) s = `${s}${s}`; s.length', "heap_units"],
  ["let a = [1]; for (let i = 0; i < 40; i++) a = [...a, ...a]; a.length", "collection_size"],
  ["let a = [1]; for (let i = 0; i < 40; i++) a = a.concat(a); a.length", "collection_size"],
  ["Array.from({length: 1e9}).length", "collection_size"],
  ['JSON.parse("[".repeat(100000) + "]".repeat(100000)).length', "ast_depth"],
  ["function f(){return f()} f()", "call_depth"],
  ["let n = 0; while (true) { n++ }", "steps"],
])("bulk work is refused before host allocation: %s", async (source, name) => {
  expect(await limit(source)).toMatchObject({ error: "LimitExceeded", limit: name })
})
