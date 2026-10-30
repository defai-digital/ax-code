import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const spinnerRoot = path.join(repoRoot, "spinner")
const committedDist = path.join(spinnerRoot, "dist")

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 1}`)
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const next = path.join(relative, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(root, next)))
    else if (entry.isFile()) files.push(next)
  }
  return files
}

run("pnpm", ["run", "typecheck"])

const generatedDist = await mkdtemp(path.join(os.tmpdir(), "ax-tui-spinner-dist-"))
try {
  run("pnpm", ["exec", "tsc", "-p", "spinner/tsconfig.build.json", "--outDir", generatedDist])

  const [committedFiles, generatedFiles] = await Promise.all([listFiles(committedDist), listFiles(generatedDist)])
  const drift = new Set([...committedFiles, ...generatedFiles])
  const mismatches: string[] = []
  for (const file of [...drift].sort()) {
    if (!committedFiles.includes(file) || !generatedFiles.includes(file)) {
      mismatches.push(file)
      continue
    }
    const [committed, generated] = await Promise.all([
      readFile(path.join(committedDist, file)),
      readFile(path.join(generatedDist, file)),
    ])
    if (!committed.equals(generated)) mismatches.push(file)
  }

  if (mismatches.length > 0) {
    console.error(`ax-tui spinner dist is stale:\n${mismatches.map((file) => `  - ${file}`).join("\n")}`)
    console.error("Run: pnpm run build")
    process.exitCode = 1
  } else {
    console.log(`✓ ax-tui spinner dist matches source (${generatedFiles.length} files)`)
  }
} finally {
  await rm(generatedDist, { recursive: true, force: true })
}
