import { createHash } from "node:crypto"
import { readFileSync, readdirSync, lstatSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../packages/akitty-sdk")
const expectedFiles = [
  "vendor/LICENSE",
  "vendor/README.md",
  "vendor/dist/index.d.ts",
  "vendor/dist/index.js",
  "vendor/package.json",
]
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")

export function verifyAkittySdk(root = packageRoot, source) {
  const receipt = JSON.parse(readFileSync(resolve(root, "SOURCE.json"), "utf8"))
  if (
    receipt.schema !== 1 ||
    receipt.package !== "@ax-code/akitty-sdk" ||
    !/^[a-f0-9]{40}$/.test(receipt.revision) ||
    !/^[a-f0-9]{64}$/.test(receipt.tarballSha256)
  )
    throw new Error("invalid AkiTTY SDK source receipt")
  const listed = Object.keys(receipt.files).sort()
  const actual = readdirSync(resolve(root, "vendor"), { recursive: true })
    .map((name) => `vendor/${name.replaceAll("\\", "/")}`)
    .filter((name) => {
      const stat = lstatSync(resolve(root, name))
      if (!stat.isFile() && !stat.isDirectory()) throw new Error("AkiTTY SDK package contains a non-regular entry")
      return stat.isFile()
    })
    .sort()
  if (
    JSON.stringify(listed) !== JSON.stringify(expectedFiles) ||
    JSON.stringify(actual) !== JSON.stringify(expectedFiles)
  ) {
    throw new Error("AkiTTY SDK package file inventory drift")
  }
  for (const name of expectedFiles) {
    const path = resolve(root, name)
    if (!lstatSync(path).isFile() || hash(readFileSync(path)) !== receipt.files[name])
      throw new Error(`AkiTTY SDK byte drift: ${name}`)
  }
  const wrapper = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
  const upstream = JSON.parse(readFileSync(resolve(root, "vendor/package.json"), "utf8"))
  if (
    wrapper.name !== receipt.package ||
    upstream.name !== receipt.package ||
    wrapper.version !== receipt.version ||
    upstream.version !== receipt.version ||
    !wrapper.private ||
    wrapper.exports?.["."]?.types !== "./vendor/dist/index.d.ts" ||
    wrapper.exports?.["."]?.default !== "./vendor/dist/index.js"
  ) {
    throw new Error("AkiTTY SDK package identity drift")
  }
  if (source) {
    const paths = ["LICENSE", "README.md", "package.json", "src/index.ts", "tsconfig.json"]
      .map((name) => `packages/akitty-sdk/${name}`)
      .sort()
    if (JSON.stringify(Object.keys(receipt.sourceFiles).sort()) !== JSON.stringify(paths))
      throw new Error("invalid SDK source inventory")
    for (const path of paths) {
      const bytes = execFileSync("git", ["-C", source, "show", `${receipt.revision}:${path}`], {
        stdio: ["ignore", "pipe", "pipe"],
      })
      if (hash(bytes) !== receipt.sourceFiles[path]) throw new Error(`AkiTTY SDK source drift: ${path}`)
    }
  }
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length && (args[0] !== "--source" || args.length !== 2))
    throw new Error("usage: verify-akitty-sdk.mjs [--source checkout]")
  const receipt = verifyAkittySdk(packageRoot, args[1])
  console.log(`AkiTTY SDK ${receipt.version}: ${expectedFiles.length} package files verified at ${receipt.revision}`)
}
