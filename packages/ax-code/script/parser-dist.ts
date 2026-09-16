import fs from "node:fs"
import path from "node:path"

const assets: Record<string, string[]> = {
  "tree-sitter-bash": ["tree-sitter-bash.wasm"],
  "tree-sitter-javascript": ["tree-sitter-javascript.wasm"],
  "tree-sitter-typescript": ["tree-sitter-typescript.wasm", "tree-sitter-tsx.wasm"],
  "web-tree-sitter": ["tree-sitter.js", "tree-sitter.cjs", "tree-sitter.wasm"],
}

/** Prune staged packages only, after installation and before signing/manifests. */
export function pruneParserDistribution(nodeModules: string) {
  // Validate the whole closure before removing anything. A dependency upgrade
  // must not silently ship a parser without its runtime or license.
  const packages = Object.entries(assets).map(([name, files]) => {
    const root = path.join(nodeModules, name)
    if (!fs.lstatSync(root).isDirectory()) throw new Error(`Expected a staged directory: ${root}`)
    const entries = fs.readdirSync(root)
    const licenses = entries.filter((file) => /^(?:licen[cs]e|notice)(?:\..*)?$/i.test(file))
    if (licenses.length === 0) throw new Error(`Missing parser license: ${name}`)
    for (const file of ["package.json", ...files, ...licenses]) {
      if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error(`Missing parser runtime file: ${name}/${file}`)
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    return { name, root, entries, files, licenses, manifest }
  })

  for (const { name, root, entries, files, licenses, manifest } of packages) {
    const keep = new Set(["package.json", ...files, ...licenses])
    for (const entry of entries) {
      if (!keep.has(entry)) fs.rmSync(path.join(root, entry), { recursive: true, force: true })
    }
    for (const field of [
      "main",
      "module",
      "types",
      "typings",
      "scripts",
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "peerDependenciesMeta",
      "optionalDependencies",
      "gypfile",
      "bin",
      "imports",
    ]) {
      delete manifest[field]
    }
    manifest.files = [...files, ...licenses]
    manifest.exports = {
      ...(name === "web-tree-sitter" ? { ".": { import: "./tree-sitter.js", require: "./tree-sitter.cjs" } } : {}),
      "./package.json": "./package.json",
      ...Object.fromEntries(files.filter((file) => file.endsWith(".wasm")).map((file) => [`./${file}`, `./${file}`])),
    }
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
  }
}
