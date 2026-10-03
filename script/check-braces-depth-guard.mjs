import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

const requireCore = createRequire(new URL("../packages/ax-code/package.json", import.meta.url))
const requireGlob = createRequire(requireCore.resolve("fast-glob"))
const requireMatch = createRequire(requireGlob.resolve("micromatch"))
export const braces = requireMatch("braces")

export function checkBracesDepthGuard() {
  const nested = "{".repeat(4000) + "a,b" + "}".repeat(4000)
  const parentheses = "(".repeat(4000) + "x" + ")".repeat(4000)
  for (const method of ["parse", "compile", "expand", "stringify"]) {
    for (const pattern of [nested, parentheses]) {
      assert.throws(() => braces[method](pattern), SyntaxError, `${method} must reject excessive nesting safely`)
    }
  }
  let ast = { type: "text", value: "x" }
  for (let i = 0; i < 4000; i++) ast = { type: "root", nodes: [ast] }
  for (const method of ["compile", "expand", "stringify"]) {
    assert.throws(() => braces[method](ast), SyntaxError, `${method} must also guard supplied ASTs`)
  }
  assert.equal(braces.compile("src/{a,b}/**/*.{ts,tsx}"), "src/(a|b)/**/*.(ts|tsx)")
  assert.deepEqual(braces.expand("src/{a,b}/{1..2}.ts"), ["src/a/1.ts", "src/a/2.ts", "src/b/1.ts", "src/b/2.ts"])
  assert.equal(braces.stringify(braces.parse("src/{a,b}/file.ts")), "src/{a,b}/file.ts")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkBracesDepthGuard()
  console.log("Verified installed braces depth guards and ordinary glob compatibility")
}
