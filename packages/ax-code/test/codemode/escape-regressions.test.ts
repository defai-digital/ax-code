import { expect, test } from "vitest"
import { execute } from "../../src/codemode/interpreter"

const run = async (source: string) => (await execute(source, { tools: [], dispatch: async () => null })).output

test.each([
  ["({}).constructor", "Forbidden property: constructor"],
  ["(()=>1).constructor", "Forbidden property: constructor"],
  ['JSON.parse(\'{"__proto__":{"x":1}}\')', "Forbidden property: __proto__"],
  ["const o = JSON.parse('{\"__proto__\":1}'); ({...o})", "Forbidden property: __proto__"],
])("forbidden keys are rejected with a controlled diagnostic: %s", async (source, message) => {
  const result = JSON.parse(await run(source)) as { error: string; message: string }
  expect(result.error).toBe("UnsupportedSyntax")
  expect(result.message).toBe(message)
})

test.each(["[].map", "[[].map]", "({f:[].map})", "Math", "JSON", "Object", "[Math.max, 1]", "JSON.stringify(()=>1)"])(
  "host builtins and closures never cross the result boundary: %s",
  async (source) => {
    const result = JSON.parse(await run(source)) as { error: string }
    expect(result.error).toBe("RuntimeError")
  },
)

test.each(["new Foo()", "new Object()", "new Array(3)", "new Promise(r=>r(1))", "new Function('return 1')"])(
  "unsupported constructors are rejected: %s",
  async (source) => {
    expect(JSON.parse(await run(source))).toMatchObject({ error: "UnsupportedSyntax" })
  },
)

test("Function and globalThis are not reachable host escapes", async () => {
  expect(JSON.parse(await run("Function('return 1')"))).toMatchObject({ error: "RuntimeError" })
  expect(await run("typeof globalThis")).not.toContain("function")
  expect(await run("typeof process")).toBe('"undefined"')
  expect(await run("typeof require")).toBe('"undefined"')
})

test("arrow functions inherit an undefined receiver without leaking structure", async () => {
  expect(await run("function f(){ const g=()=>this; return g() } f()")).toBe("null")
})

test("host error text never carries stacks or host paths", async () => {
  for (const source of ["null.x", "new Date(NaN).toISOString()", "for (const k in 5) k", "'a' in 5"]) {
    const output = await run(source)
    expect(output).not.toMatch(/\bat \S+ \(|node_modules|\/Users\//)
  }
})
