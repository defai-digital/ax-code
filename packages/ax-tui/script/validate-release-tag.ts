import { readFileSync } from "node:fs"

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const tag = process.argv[2]

if (manifest.name !== "@defai-digital/ax-tui" || manifest.publishConfig?.registry !== "https://npm.pkg.github.com" ||
    manifest.publishConfig?.access !== "public") {
  throw new Error("Releases must target the public @defai-digital/ax-tui package on GitHub Packages")
}
if (typeof manifest.version !== "string" || tag !== `v${manifest.version}`) {
  throw new Error(`Release tag must be v${manifest.version}, received ${tag ?? "no tag"}`)
}
console.log(`Validated ${tag} against package.json and public GitHub Packages configuration`)
