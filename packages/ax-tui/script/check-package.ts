import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
if (manifest.name !== "@defai-digital/ax-tui" || manifest.publishConfig?.registry !== "https://npm.pkg.github.com" ||
    manifest.publishConfig?.access !== "public") {
  throw new Error("Package must target public GitHub Packages publication")
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const result = spawnSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root,
  encoding: "utf8",
  shell: process.platform === "win32",
  env: { ...process.env, NODE_AUTH_TOKEN: process.env.NODE_AUTH_TOKEN ?? "" },
  maxBuffer: 8 * 1024 * 1024,
})
if (result.status !== 0) throw new Error(`npm pack failed: ${result.stderr}`)
const [packed] = JSON.parse(result.stdout) as [{ files: { path: string }[]; size: number }]
const files = new Set(packed.files.map((file) => file.path))
for (const file of files) {
  if (file.split("/").some((part) => part.startsWith(".")) ||
      /^(?:src|test|script|patches|node_modules|native\/(?:source|renderer)|solid\/source|(?:spinner|chart)\/src)\//.test(file) ||
      /(?:^|\/)(?:AGENTS\.md|pnpm-lock\.yaml|.*\.tsbuildinfo)$/.test(file)) {
    throw new Error(`Development or private file included in package: ${file}`)
  }
}
function verifyExports(value: unknown): void {
  if (typeof value === "string") {
    if (!value.startsWith("./") || !files.has(value.slice(2))) throw new Error(`Missing packed export: ${value}`)
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) verifyExports(entry)
  }
}
verifyExports(manifest.exports)
for (const file of ["package.json", "LICENSE", "solid/LICENSE", "vendor/manifest.json", "assets/javascript/tree-sitter-javascript.wasm"]) {
  if (!files.has(file)) throw new Error(`Missing runtime package file: ${file}`)
}
const native = JSON.parse(readFileSync(path.join(root, "vendor/manifest.json"), "utf8"))
for (const [target, entry] of Object.entries(native.targets) as [string, {
  lib: { file: string; sha256: string; size: number }; licenseSha256: string
}][]) {
  for (const [name, hash] of [[entry.lib.file, entry.lib.sha256], ["LICENSE", entry.licenseSha256]]) {
    const file = `vendor/${target}/${name}`
    if (!files.has(file)) throw new Error(`Missing packed native artifact: ${file}`)
    const bytes = readFileSync(path.join(root, file))
    if (createHash("sha256").update(bytes).digest("hex") !== hash ||
        (name === entry.lib.file && bytes.length !== entry.lib.size)) {
      throw new Error(`Packed native artifact does not match manifest: ${file}`)
    }
  }
}
console.log(`Verified public GitHub Packages payload: ${files.size} files, ${packed.size} bytes, all exports and native hashes`)
