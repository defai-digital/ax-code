import path from "node:path"
import { fileURLToPath } from "node:url"

// windows-2022 runs the runtime suite on every review. windows-11-arm is scarce
// and dominated by toolchain, install, and the node-pty rebuild, so it runs
// only when one of these inputs can change that ARM result.
const PREFIXES = ["packages/ax-code/src/pty/", "packages/ax-code/src/cli/bootstrap/"] as const

const FILES = new Set([
  "script/rebuild-node-pty.mjs",
  "script/verify-pty.cjs",
  "script/ci-windows-arm-needed.ts",
  "patches/node-pty-prebuilt-multiarch@0.10.1-pre.5.patch",
  ".github/workflows/ax-code-ci.yml",
  ".github/scripts/assert-windows-pty-build.cjs",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "packages/ax-code/test/cli/bootstrap/windows-console.test.ts",
  "packages/ax-code/test/cli/tui/process-wire.test.ts",
  "packages/ax-code/test/snapshot/windows-paths.test.ts",
  "packages/ax-code/test/tool/bash-process-cleanup.test.ts",
  "packages/ax-code/test/tool/bash-process-cleanup-native.test.ts",
])

export function windowsArmRuntimeNeeded(files: readonly string[]) {
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
  process.exitCode = windowsArmRuntimeNeeded(files) ? 0 : 1
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  void main()
}
