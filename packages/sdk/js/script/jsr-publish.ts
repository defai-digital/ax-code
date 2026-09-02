import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

type JsonObject = Record<string, unknown>

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const repoRoot = path.resolve(packageRoot, "../../..")
const args = process.argv.slice(2)

function parseJson(value: string, source: string): JsonObject {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${source} must contain a JSON object`)
  }
  return parsed as JsonObject
}

function stringField(input: JsonObject, field: string, source: string): string {
  const value = input[field]
  if (typeof value !== "string" || !value) throw new Error(`${source} must define a non-empty ${field}`)
  return value
}

function recordField(input: JsonObject, field: string, source: string): Record<string, string> {
  const value = input[field]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} must define an object ${field}`)
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") throw new Error(`${source} ${field}.${key} must be a string`)
  }
  return value as Record<string, string>
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function resolveCatalogVersion(name: string, workspaceSource: string): string {
  const key = escapeRegExp(name)
  const pattern = new RegExp(`^\\s{2}(?:"${key}"|'${key}'|${key}):\\s*["']([^"']+)["']\\s*$`, "m")
  const match = workspaceSource.match(pattern)
  if (!match?.[1]) throw new Error(`Unable to resolve catalog version for ${name}`)
  return match[1]
}

function resolveRuntimeDependencies(
  dependencies: Record<string, string>,
  workspaceSource: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, version]) => {
      if (version === "catalog:") return [name, resolveCatalogVersion(name, workspaceSource)]
      if (/^(?:workspace|file|link):/.test(version)) {
        throw new Error(`Public JSR runtime dependency ${name} cannot use ${version}`)
      }
      return [name, version]
    }),
  )
}

function assertTokenlessPublication(): void {
  if (process.env.JSR_TOKEN) throw new Error("JSR_TOKEN is not accepted; use browser authentication or GitHub OIDC")
  if (args.some((arg) => arg === "--token" || arg.startsWith("--token="))) {
    throw new Error("Token arguments are not accepted; use browser authentication or GitHub OIDC")
  }
}

function resolveJsrBin(): string {
  const require = createRequire(import.meta.url)
  return path.resolve(path.dirname(require.resolve("jsr")), "bin.js")
}

async function attachSelfTypes(directory: string): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) return attachSelfTypes(file)
      if (!entry.isFile() || !entry.name.endsWith(".js")) return

      const declaration = file.replace(/\.js$/, ".d.ts")
      await fs.access(declaration).catch(() => {
        throw new Error(`Compiled JSR module is missing its declaration file: ${declaration}`)
      })
      const directive = `/* @ts-self-types="./${path.basename(declaration)}" */\n`
      const source = await fs.readFile(file, "utf8")
      await fs.writeFile(file, source.startsWith("/* @ts-self-types=") ? source : `${directive}${source}`)
    }),
  )
}

function runJsr(bin: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const publishArgs =
      args.includes("--dry-run") && !args.includes("--allow-dirty") ? [...args, "--allow-dirty"] : args
    const child = spawn(process.execPath, [bin, "publish", ...publishArgs], {
      cwd,
      env: process.env,
      stdio: "inherit",
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve()
      reject(new Error(`jsr publish exited with ${code ?? `signal ${signal ?? "unknown"}`}`))
    })
  })
}

assertTokenlessPublication()

const [packageSource, jsrSource, workspaceSource] = await Promise.all([
  fs.readFile(path.join(packageRoot, "package.json"), "utf8"),
  fs.readFile(path.join(packageRoot, "jsr.json"), "utf8"),
  fs.readFile(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"),
])
const packageManifest = parseJson(packageSource, "package.json")
const jsrManifest = parseJson(jsrSource, "jsr.json")
const packageVersion = stringField(packageManifest, "version", "package.json")
const jsrVersion = stringField(jsrManifest, "version", "jsr.json")
const jsrName = stringField(jsrManifest, "name", "jsr.json")
if (packageVersion !== jsrVersion) {
  throw new Error(`SDK version mismatch: package.json=${packageVersion}, jsr.json=${jsrVersion}`)
}

const dependencies = resolveRuntimeDependencies(
  recordField(packageManifest, "dependencies", "package.json"),
  workspaceSource,
)
const stagingParent = path.join(repoRoot, ".tmp")
await fs.mkdir(stagingParent, { recursive: true })
const stagingRoot = await fs.mkdtemp(path.join(stagingParent, "ax-code-sdk-jsr-"))

try {
  await Promise.all([
    fs.cp(path.join(packageRoot, "dist"), path.join(stagingRoot, "dist"), { recursive: true }),
    fs.copyFile(path.join(packageRoot, "README.md"), path.join(stagingRoot, "README.md")),
    fs.copyFile(path.join(packageRoot, "ARCHITECTURE.md"), path.join(stagingRoot, "ARCHITECTURE.md")),
    fs.copyFile(path.join(repoRoot, "LICENSE"), path.join(stagingRoot, "LICENSE")),
    fs.copyFile(path.join(packageRoot, "jsr.json"), path.join(stagingRoot, "jsr.json")),
  ])
  await attachSelfTypes(path.join(stagingRoot, "dist"))

  const publicManifest = {
    name: jsrName,
    version: jsrVersion,
    description: "TypeScript SDK for the AX Code coding-agent runtime",
    type: "module",
    license: "Apache-2.0",
    engines: { node: ">=24" },
    repository: {
      type: "git",
      url: "https://github.com/defai-digital/ax-code.git",
      directory: "packages/sdk/js",
    },
    dependencies,
  }
  await fs.writeFile(path.join(stagingRoot, "package.json"), `${JSON.stringify(publicManifest, null, 2)}\n`)
  await fs.symlink(path.join(packageRoot, "node_modules"), path.join(stagingRoot, "node_modules"), "junction")
  await runJsr(resolveJsrBin(), stagingRoot)
} finally {
  await fs.rm(stagingRoot, { recursive: true, force: true })
}
