import { createRequire } from "node:module"
import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import z from "zod"
import { parseJsonStrict } from "./internal/json-value"

const require = createRequire(import.meta.url)
const Manifest = z.object({
  name: z.string(),
  version: z.string(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
})

function manifest(file: string) {
  return Manifest.parse(parseJsonStrict(readFileSync(file, "utf8")))
}

// Resolve the shipped runtime dependency, never a project's PATH or a registry runner.
export function resolveNativeTypescript(
  input: {
    packageJsonPath?: string
    platform?: NodeJS.Platform
    arch?: string
  } = {},
) {
  try {
    const packageJson = input.packageJsonPath ?? require.resolve("@typescript/native/package.json")
    const compiler = manifest(packageJson)
    if (compiler.name !== "typescript" || !/^7\./.test(compiler.version)) {
      throw new Error("Expected the official TypeScript 7 compiler package")
    }
    const platform = input.platform ?? process.platform
    const arch = input.arch ?? process.arch
    const platformName = `@typescript/typescript-${platform}-${arch}`
    if (compiler.optionalDependencies?.[platformName] !== compiler.version) {
      throw new Error(`No matching native package declared for ${platform}-${arch}`)
    }
    const platformJson = createRequire(packageJson).resolve(`${platformName}/package.json`)
    const native = manifest(platformJson)
    if (native.name !== platformName || native.version !== compiler.version) {
      throw new Error(`Native package version does not match TypeScript ${compiler.version}`)
    }
    const executable = path.join(path.dirname(platformJson), "lib", platform === "win32" ? "tsc.exe" : "tsc")
    if (!statSync(executable).isFile()) throw new Error("Native executable is not a file")
    return { executable, version: compiler.version }
  } catch (cause) {
    throw new Error(
      "TypeScript 7 native LSP is unavailable. Reinstall AX Code with optional dependencies enabled, or configure lsp.typescript.command explicitly.",
      { cause },
    )
  }
}
