import path from "node:path"
import { fileURLToPath } from "node:url"

const PREFIXES = ["crates/", "packages/ax-code-fs-native/", ".github/actions/build-evidence-cache/"] as const

const FILES = new Set([
  "script/build-native.ts",
  "script/verify-evidence-cache.cjs",
  "script/verify-evidence-cache.test.ts",
  "script/ci-native-evidence-needed.ts",
  "rust-toolchain.toml",
  ".github/workflows/ax-code-ci.yml",
  "pnpm-lock.yaml",
  "package.json",
])

export function nativeEvidenceNeeded(files: readonly string[]) {
  return files.some(
    (file) => FILES.has(file) || PREFIXES.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix)),
  )
}

async function readStdin() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

async function main() {
  const fromArgs = process.argv.slice(2)
  const files =
    fromArgs.length > 0
      ? fromArgs
      : (await readStdin())
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
  process.exitCode = nativeEvidenceNeeded(files) ? 0 : 1
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  void main()
}
