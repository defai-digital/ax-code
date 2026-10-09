import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const repoRoot = path.resolve(packageRoot, "../../..")
const require = createRequire(import.meta.url)
const compilerManifestPath = require.resolve("@typescript/native/package.json")
const compilerManifest = JSON.parse(await fs.readFile(compilerManifestPath, "utf8")) as { bin: Record<string, string> }
const compiler = path.resolve(path.dirname(compilerManifestPath), compilerManifest.bin.tsc)

async function run(args: string[], cwd: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: "inherit", env: { ...process.env, NODE_PATH: "" } })
    child.once("error", reject)
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Consumer check exited ${code}`))))
  })
}

// Compile current sources before inspecting public artifacts. Generation drift
// is checked separately by the canonical SDK build and CI.
await run([compiler, "--build", "--force"], packageRoot)
await fs.cp(path.resolve(packageRoot, "../proto"), path.join(packageRoot, "dist/proto"), { recursive: true })
const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string
  exports: Record<string, string>
  dependencies: Record<string, string>
}
const publicName = "@defai-digital/ax-code-sdk"
const consumerRoot = await fs.mkdtemp(path.join(tmpdir(), "ax-code-sdk-consumer-"))
const installedRoot = path.join(consumerRoot, "node_modules", publicName)
const copiedDependencies = new Map<string, string>()

async function findDependency(name: string, from: string): Promise<string> {
  for (let dir = from; dir.startsWith(`${repoRoot}${path.sep}`) || dir === repoRoot; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name)
    const real = await fs.realpath(candidate).catch(() => undefined)
    if (real) return real
  }
  throw new Error(`Cannot resolve isolated consumer dependency: ${name}`)
}

async function copyDependency(name: string, from: string): Promise<string> {
  const source = await findDependency(name, from)
  const dependency = JSON.parse(await fs.readFile(path.join(source, "package.json"), "utf8")) as {
    version: string
    dependencies?: Record<string, string>
  }
  const existing = copiedDependencies.get(name)
  if (existing) {
    if (existing !== dependency.version) throw new Error(`Consumer dependency version conflict: ${name}`)
    return existing
  }
  copiedDependencies.set(name, dependency.version)
  await fs.cp(source, path.join(consumerRoot, "node_modules", name), { recursive: true, dereference: true })
  for (const child of Object.keys(dependency.dependencies ?? {})) await copyDependency(child, source)
  return dependency.version
}

try {
  await fs.mkdir(installedRoot, { recursive: true })
  await fs.cp(path.join(packageRoot, "dist"), path.join(installedRoot, "dist"), { recursive: true })
  const dependencies: Record<string, string> = {}
  for (const name of Object.keys(manifest.dependencies)) dependencies[name] = await copyDependency(name, packageRoot)
  await copyDependency("@types/node", packageRoot)
  await fs.writeFile(
    path.join(installedRoot, "package.json"),
    JSON.stringify({
      name: publicName,
      version: manifest.version,
      type: "module",
      exports: manifest.exports,
      dependencies,
    }),
  )
  await fs.writeFile(path.join(consumerRoot, "package.json"), JSON.stringify({ type: "module" }))
  await fs.writeFile(
    path.join(consumerRoot, "consumer.ts"),
    `
import { SDK_VERSION } from "${publicName}"
import { createHeadlessClient, HeadlessRequestError, checkHeadlessRuntimeCompatibility } from "${publicName}/headless"
import type { HeadlessRequestOptions, HeadlessSteerInput, HeadlessSteerReceipt, HeadlessSteeringState, HeadlessTaskQueueSteerResult, HeadlessTransport } from "${publicName}/headless"
const options: HeadlessRequestOptions = { signal: new AbortController().signal, timeoutMs: 1000 }
const client = createHeadlessClient({ baseUrl: "http://127.0.0.1:4096", requestOptions: options })
async function contracts() {
  const state: HeadlessSteeringState = await client.steering("session-1", options)
  if (!state.generation) return
  const input: HeadlessSteerInput = { expectedGeneration: state.generation, clientID: "client-1", text: "Correction" }
  const receipt: HeadlessSteerReceipt = await client.steer("session-1", input, options)
  const result: HeadlessTaskQueueSteerResult = await client.taskQueue.steer("task-1", options)
  await client.sendPrompt("session-1", { parts: [] }, { ...options, mode: "async" })
  return { receipt, result, sdkVersion: SDK_VERSION, compatible: checkHeadlessRuntimeCompatibility(await client.capabilities()).compatible }
}
const error = new HeadlessRequestError({ status: 409, body: { code: "conflict" }, method: "POST", path: "/session" })
const status: number = error.status
void contracts; void status
// @ts-expect-error Steering requires the generation observed by the caller.
client.steer("session-1", { clientID: "client-1", text: "Correction" })
const transport: HeadlessTransport = {
  async requestJson<T>() { return {} as T },
  async sendCommand(_command, requestOptions) { requestOptions?.signal?.throwIfAborted(); return { accepted: true, status: 202 } },
  async *subscribe() {},
}
void transport
`,
  )
  await run(
    [
      compiler,
      "--noEmit",
      "--strict",
      "--target",
      "es2022",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      "--types",
      "node",
      "consumer.ts",
    ],
    consumerRoot,
  )
  await fs.writeFile(
    path.join(consumerRoot, "consumer.mjs"),
    `
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { SDK_VERSION } from "${publicName}"
import { createHeadlessClient, HeadlessRequestError, checkHeadlessRuntimeCompatibility } from "${publicName}/headless"
import { resolveAxCodeGrpcProtoUrl } from "${publicName}/grpc"
const exports = ${JSON.stringify(Object.keys(manifest.exports))}
for (const entry of exports) await import(entry === "." ? "${publicName}" : "${publicName}" + entry.slice(1))
assert.equal(SDK_VERSION, ${JSON.stringify(manifest.version)})
assert.ok((await fs.readFile(resolveAxCodeGrpcProtoUrl(), "utf8")).includes("syntax ="))
const capabilities = { schemaVersion: 1, product: "ax-code", version: "7.23.0", compatibility: { sdkHeadless: { schemaVersion: 1 } }, features: { sessions: true } }
assert.equal(checkHeadlessRuntimeCompatibility(capabilities, { requiredFeatures: ["sessions"] }).compatible, true)
const receipt = { sessionID: "session-1", generation: "generation-1", clientID: "client-1", status: "accepted" }
const client = createHeadlessClient({ baseUrl: "http://127.0.0.1:4096", fetch: async (_url, init) => Response.json(init.method === "POST" ? receipt : { generation: receipt.generation, receipts: [], retention: "process-local; at most 256 receipts per session" }) })
const state = await client.steering("session-1")
assert.equal((await client.steer("session-1", { expectedGeneration: state.generation, clientID: "client-1", text: "Correction" })).status, "accepted")
const conflict = createHeadlessClient({ baseUrl: "http://127.0.0.1:4096", fetch: async () => Response.json({ code: "conflict" }, { status: 409 }) })
await assert.rejects(conflict.taskQueue.steer("task-1"), (error) => error instanceof HeadlessRequestError && error.status === 409)
console.log("Isolated consumer passed: public exports, declarations, proto, steering, and structured errors")
`,
  )
  await run(["consumer.mjs"], consumerRoot)
} finally {
  await fs.rm(consumerRoot, { recursive: true, force: true })
}
