import { fileURLToPath, pathToFileURL } from "url"
import { spawn } from "child_process"
import { createRequire } from "module"
import { createWriteStream, readFileSync } from "fs"
import fs from "fs/promises"
import path from "path"
import { setTimeout as sleep } from "timers/promises"
import { createClient } from "@hey-api/openapi-ts"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(dir, "../../..")
const axCodeDir = path.resolve(dir, "../../ax-code")
const solidLoader = pathToFileURL(path.join(repoRoot, "script", "solid-loader.mjs")).href
const tsxLoader = pathToFileURL(require.resolve("tsx")).href
const buildLockDir = path.join(repoRoot, "node_modules", ".cache", "ax-code-sdk-build.lock")
const buildLockStaleMs = 20 * 60 * 1000
const buildLockPollMs = 250

// Resolve JavaScript CLI entrypoints and run them through Node. Directly
// spawning package-manager shims is not portable on Windows.
function packageBin(packageName: string, binName = packageName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`)
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { bin?: string | Record<string, string> }
  const bin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[binName]
  if (!bin) throw new Error(`${packageName} does not declare a ${binName} bin`)
  return path.resolve(path.dirname(packageJsonPath), bin)
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; toFile?: string } = {}) {
  return new Promise<void>((resolve, reject) => {
    const out = opts.toFile ? createWriteStream(opts.toFile) : undefined
    const proc = spawn(cmd, args, {
      cwd: opts.cwd ?? dir,
      env: opts.env ?? process.env,
      stdio: ["inherit", out ? "pipe" : "inherit", "inherit"],
    })
    if (out && proc.stdout) proc.stdout.pipe(out)
    proc.on("error", reject)
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))))
  })
}

async function patchGeneratedSseClient(outputPath: string) {
  const file = path.join(dir, outputPath, "core", "serverSentEvents.gen.ts")
  await run(process.execPath, [packageBin("prettier"), "--write", file])
  let source = await fs.readFile(file, "utf8")

  const replacements: Array<[RegExp, string]> = [
    [
      /    while \(true\) \{\n      if \(signal\.aborted\) break\n\n      attempt\+\+/,
      `    while (true) {
      if (signal.aborted) break;`,
    ],
    [
      /        const reader = response\.body\.pipeThrough\(new TextDecoderStream\(\)\)\.getReader\(\)\n\n        let buffer = ""/,
      `        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        attempt = 0

        let buffer = ""
        let completed = false`,
    ],
    [
      /            const \{ done, value \} = await reader\.read\(\)\n            if \(done\) break/,
      `            const { done, value } = await reader.read()
            if (done) {
              completed = true
              break
            }`,
    ],
    [
      /        \} finally \{\n          signal\.removeEventListener\("abort", abortHandler\)\n          reader\.releaseLock\(\)\n        \}/,
      `        } finally {
          signal.removeEventListener("abort", abortHandler)
          if (!completed) {
            await reader.cancel().catch(() => undefined)
          }
          reader.releaseLock()
        }`,
    ],
    [
      /        onSseError\?\.\(error\)\n\n        if \(sseMaxRetryAttempts !== undefined && attempt >= sseMaxRetryAttempts\) \{\n          break \/\/ stop after firing error\n        \}\n\n        \/\/ exponential backoff: double retry each attempt, cap at 30s\n        const backoff = Math\.min\(retryDelay \* 2 \*\* \(attempt - 1\), sseMaxRetryDelay \?\? 30000\)/,
      `        onSseError?.(error)
        attempt += 1

        if (sseMaxRetryAttempts !== undefined && attempt > sseMaxRetryAttempts) {
          break // stop after firing error
        }

        // exponential backoff: double retry each attempt, cap at 30s
        const backoffExponent = Math.max(attempt - 2, 0)
        const backoff = Math.min(retryDelay * 2 ** backoffExponent, sseMaxRetryDelay ?? 30000)
`,
    ],
  ]

  for (const [pattern, after] of replacements) {
    const next = source.replace(pattern, after)
    if (next === source) {
      throw new Error(`Generated SSE client changed shape; failed to patch ${file}`)
    }
    source = next
  }

  await fs.writeFile(file, source)
}

async function patchGeneratedParamsClient(outputPath: string) {
  const file = path.join(dir, outputPath, "core", "params.gen.ts")
  let source = await fs.readFile(file, "utf8")
  const helper = `const isUnsafeParamKey = (key: string) => key === "__proto__" || key === "prototype" || key === "constructor"

const setParamValue = (target: Record<string, unknown>, key: string, value: unknown) => {
  if (isUnsafeParamKey(key)) {
    return
  }
  target[key] = value
}

`

  if (!source.includes("const setParamValue = ")) {
    const marker = "export const buildClientParams = "
    if (!source.includes(marker)) {
      throw new Error(`Generated params client changed shape; failed to patch ${file}`)
    }
    source = source.replace(marker, `${helper}${marker}`)
  }

  const replacements: Array<[string, string]> = [
    [
      `(params[field.in] as Record<string, unknown>)[name] = arg;`,
      `setParamValue(params[field.in] as Record<string, unknown>, name, arg);`,
    ],
    [
      `(params[field.in] as Record<string, unknown>)[name] = value;`,
      `setParamValue(params[field.in] as Record<string, unknown>, name, value);`,
    ],
    [
      `(params[slot] as Record<string, unknown>)[key.slice(prefix.length)] = value;`,
      `setParamValue(params[slot] as Record<string, unknown>, key.slice(prefix.length), value);`,
    ],
    [
      `(params[slot as Slot] as Record<string, unknown>)[key] = value;`,
      `setParamValue(params[slot as Slot] as Record<string, unknown>, key, value);`,
    ],
  ]

  for (const [before, after] of replacements) {
    if (!source.includes(before) && !source.includes(after)) {
      throw new Error(`Generated params client changed shape; failed to patch ${file}`)
    }
    source = source.replace(before, after)
  }

  await fs.writeFile(file, source)
}

async function acquireBuildLock() {
  let announcedWait = false
  await fs.mkdir(path.dirname(buildLockDir), { recursive: true })

  while (true) {
    try {
      await fs.mkdir(buildLockDir, { recursive: false })
      await fs.writeFile(
        path.join(buildLockDir, "owner.json"),
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
      )
      return async () => {
        await fs.rm(buildLockDir, { recursive: true, force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error

      const stat = await fs.stat(buildLockDir).catch(() => undefined)
      const ageMs = stat ? Date.now() - stat.mtimeMs : 0
      if (stat && ageMs > buildLockStaleMs) {
        await fs.rm(buildLockDir, { recursive: true, force: true })
        continue
      }

      if (!announcedWait) {
        console.error(`Another SDK build is running; waiting for ${buildLockDir}`)
        announcedWait = true
      }
      await sleep(buildLockPollMs)
    }
  }
}

const tmp = path.join(dir, ".tmp", "xdg")
const releaseBuildLock = await acquireBuildLock()

try {
  await fs.mkdir(path.join(tmp, "data"), { recursive: true })
  await fs.mkdir(path.join(tmp, "config"), { recursive: true })
  await fs.mkdir(path.join(tmp, "cache"), { recursive: true })
  await fs.mkdir(path.join(tmp, "state"), { recursive: true })

  await run(process.execPath, [packageBin("typescript", "tsc"), "--build", "--force"])

  // Generate the OpenAPI document through the non-TUI Node entrypoint. The TUI
  // entrypoint requires Node's FFI tier, but SDK generation must run on the
  // repository's baseline Node version.
  await run(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--import",
      tsxLoader,
      "--import",
      solidLoader,
      "--conditions=node",
      path.join(axCodeDir, "src", "index-node.ts"),
      "generate",
    ],
    {
      cwd: axCodeDir,
      toFile: path.join(dir, "openapi.json"),
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: path.join(axCodeDir, "tsconfig.json"),
        XDG_DATA_HOME: path.join(tmp, "data"),
        XDG_CONFIG_HOME: path.join(tmp, "config"),
        XDG_CACHE_HOME: path.join(tmp, "cache"),
        XDG_STATE_HOME: path.join(tmp, "state"),
      },
    },
  )

  const generateClient = (outputPath: string) =>
    createClient({
      input: "./openapi.json",
      output: {
        path: outputPath,
        tsConfigPath: path.join(dir, "tsconfig.json"),
        clean: true,
      },
      plugins: [
        {
          name: "@hey-api/typescript",
          exportFromIndex: false,
        },
        {
          name: "@hey-api/sdk",
          instance: "OpencodeClient",
          exportFromIndex: false,
          auth: false,
          paramsStructure: "flat",
        },
        {
          name: "@hey-api/client-fetch",
          exportFromIndex: false,
          baseUrl: "http://localhost:4096",
        },
      ],
    })

  await generateClient("./src/gen")
  await generateClient("./src/v2/gen")
  await patchGeneratedParamsClient("./src/gen")
  await patchGeneratedParamsClient("./src/v2/gen")
  await patchGeneratedSseClient("./src/gen")
  await patchGeneratedSseClient("./src/v2/gen")

  await run(process.execPath, [packageBin("prettier"), "--write", "src/gen"])
  await run(process.execPath, [packageBin("prettier"), "--write", "src/v2"])
  await fs.rm(path.join(dir, "dist"), { recursive: true, force: true })
  await run(process.execPath, [packageBin("typescript", "tsc"), "--build", "--force"])
  await fs.cp(path.resolve(dir, "../proto"), path.join(dir, "dist", "proto"), { recursive: true })
  await fs.rm(path.join(dir, "openapi.json"), { force: true })
} finally {
  await fs.rm(path.join(dir, ".tmp"), { recursive: true, force: true })
  await releaseBuildLock()
}
