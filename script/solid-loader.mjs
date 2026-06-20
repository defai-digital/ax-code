// Node-from-source loader for the TUI: layers OpenTUI's Solid JSX transform on
// top of tsx so `node --import tsx --import ./script/solid-loader.mjs src/...`
// runs the app (incl. the TUI) from source under Node. tsx handles .ts +
// extension resolution; this hook owns .tsx (Solid → universal renderer) and
// the Bun→Node module aliases + the global compat shim.
import { registerHooks, createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const require = createRequire(import.meta.url)
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../packages/ax-code")

// Babel + presets come from @opentui/solid's own dependency tree. Resolve
// @opentui/solid from the ax-code package (where it's a dependency), then
// resolve its nested babel deps relative to its entry.
const pkgRequire = createRequire(pathToFileURL(path.join(pkgRoot, "package.json")).href)
const osRequire = createRequire(pkgRequire.resolve("@opentui/solid"))
const babel = osRequire("@babel/core")
const solidPreset = osRequire("babel-preset-solid")
const tsPreset = osRequire("@babel/preset-typescript")

const aliases = new Map([
  ["#db", pathToFileURL(path.join(pkgRoot, "src/storage/db.node.ts")).href],
  ["bun-pty", pathToFileURL(path.join(pkgRoot, "src/pty/bun-pty-node-stub.ts")).href],
])
const rebind = new Map([
  ["drizzle-orm/bun-sqlite", "drizzle-orm/node-sqlite"],
  ["drizzle-orm/bun-sqlite/migrator", "drizzle-orm/node-sqlite/migrator"],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    const aliased = aliases.get(specifier)
    if (aliased) return { url: aliased, shortCircuit: true }
    const rebound = rebind.get(specifier)
    if (rebound) return nextResolve(rebound, context)
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    // Text-asset imports (Bun's `import x from "./f.txt"`) → string default.
    if (url.startsWith("file:") && /\.(txt|md|scm)(\?|$)/.test(url)) {
      const file = fileURLToPath(url.replace(/\?.*$/, ""))
      const text = readFileSync(file, "utf8")
      return { format: "module", source: `export default ${JSON.stringify(text)}`, shortCircuit: true }
    }
    if (url.startsWith("file:") && /\.tsx(\?|$)/.test(url)) {
      const file = fileURLToPath(url.replace(/\?.*$/, ""))
      const code = readFileSync(file, "utf8")
      const out = babel.transformSync(code, {
        filename: file,
        configFile: false,
        babelrc: false,
        presets: [[solidPreset, { moduleName: "@opentui/solid", generate: "universal" }], [tsPreset]],
      })
      return { format: "module", source: out.code ?? code, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})

// Install the Bun→Node global shim. node-compat.ts is .ts, so it loads through
// tsx (already registered) — import it dynamically after our hooks are in place.
const { installNodeBunCompat } = await import(pathToFileURL(path.join(pkgRoot, "src/bun/node-compat.ts")).href)
installNodeBunCompat()
