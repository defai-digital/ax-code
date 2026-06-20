// PoC codemod: bun:test -> vitest. Operates in-place on test-vitest/.
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "../test-vitest")

const KEEP = new Set([
  "test",
  "it",
  "describe",
  "expect",
  "beforeAll",
  "afterAll",
  "beforeEach",
  "afterEach",
])

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full)
  }
  return out
}

// Note: keep trailing match to horizontal whitespace only so the line's
// newline is preserved (otherwise the next import joins onto this line).
const importRe = /import\s*\{([^}]*)\}\s*from\s*["']bun:test["'][^\S\n]*;?/

let changed = 0
for (const file of walk(root)) {
  let src = fs.readFileSync(file, "utf8")
  const m = src.match(importRe)
  if (!m) continue

  const named = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  const kept = named.filter((n) => KEEP.has(n.split(" as ")[0].trim()))
  const usesViHelpers = named.some((n) => {
    const base = n.split(" as ")[0].trim()
    return base === "spyOn" || base === "mock"
  })

  // Body rewrites
  src = src.replace(/(?<![.\w])spyOn\(/g, "vi.spyOn(")
  src = src.replace(/(?<![.\w])mock\.module\(/g, "vi.mock(")
  src = src.replace(/(?<![.\w])mock\.restore\(/g, "vi.restoreAllMocks(")
  src = src.replace(/(?<![.\w])mock\(/g, "vi.fn(")
  // Bun's `import.meta.dir` → the Node-standard `import.meta.dirname`.
  src = src.replace(/\bimport\.meta\.dir\b(?!name)/g, "import.meta.dirname")

  const needVi = usesViHelpers || /\bvi\./.test(src)
  const finalNamed = [...kept]
  if (needVi && !finalNamed.includes("vi")) finalNamed.push("vi")

  src = src.replace(importRe, `import { ${finalNamed.join(", ")} } from "vitest"`)

  fs.writeFileSync(file, src)
  changed++
}

console.log(`codemod applied to ${changed} files`)
