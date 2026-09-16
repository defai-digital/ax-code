import fs from "node:fs"
import path from "node:path"

export type NativeAddonPackage = {
  name: "fs" | "diff" | "parser" | "index-core"
  dir: string
  binaryName: string
}

export const NATIVE_ADDON_PACKAGES: readonly NativeAddonPackage[] = [
  { name: "fs", dir: "ax-code-fs-native", binaryName: "ax-code-fs" },
  { name: "diff", dir: "ax-code-diff-native", binaryName: "ax-code-diff" },
  { name: "parser", dir: "ax-code-parser-native", binaryName: "ax-code-parser" },
  { name: "index-core", dir: "ax-code-index-core", binaryName: "index-core" },
]

export type NativeAddonPayloadInspection = {
  ready: boolean
  missing: string[]
  indexJs: string
  binary: string
}

export function inspectNativeAddonPayload(packageDir: string, binaryName: string): NativeAddonPayloadInspection {
  const indexJs = path.join(packageDir, "index.js")
  const binary = path.join(packageDir, `${binaryName}.node`)
  const missing = [
    fs.existsSync(indexJs) ? undefined : "index.js",
    fs.existsSync(binary) ? undefined : `${binaryName}.node`,
  ].filter((value): value is string => value !== undefined)
  return { ready: missing.length === 0, missing, indexJs, binary }
}

export function nativeAddonIncompleteMessage(name: string, missing: readonly string[], location: string) {
  return `native addon ${name} is incomplete in ${location} (missing ${missing.join(", ")}); run pnpm build:native`
}
