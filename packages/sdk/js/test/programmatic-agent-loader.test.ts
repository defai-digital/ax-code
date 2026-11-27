import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import typescript from "typescript"
import { afterEach, describe, expect, test } from "vitest"
import { isMissingAxCodeRuntimeError } from "../src/programmatic/runtime-loader.js"

const sourceDir = resolve(import.meta.dirname, "../src/programmatic")
const originalCwd = process.cwd()
const tempDirs: string[] = []

afterEach(async () => {
  process.chdir(originalCwd)
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "ax-code-sdk-loader-"))
  tempDirs.push(dir)
  return dir
}

async function writeRuntimeFixture(root: string, programmaticSource: string) {
  const packageDir = join(root, "node_modules", "ax-code")
  await mkdir(join(packageDir, "src", "sdk"), { recursive: true })
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "ax-code",
      type: "module",
      exports: { "./*": "./src/*.js" },
    }),
  )
  await writeFile(join(packageDir, "src", "sdk", "programmatic.js"), programmaticSource)
}

// A package laid out directly under `root`, as `NODE_PATH` entries are.
async function writeNodePathFixture(root: string, programmaticSource: string) {
  const packageDir = join(root, "ax-code")
  await mkdir(join(packageDir, "src", "sdk"), { recursive: true })
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "ax-code",
      type: "module",
      exports: { "./*": "./src/*.js" },
    }),
  )
  await writeFile(join(packageDir, "src", "sdk", "programmatic.js"), programmaticSource)
}

// A workspace-looking package with no `exports` map. It must be treated as no
// match, otherwise CommonJS resolution falls back to NODE_PATH.
async function writeUnshapedRuntimeFixture(root: string) {
  const packageDir = join(root, "node_modules", "ax-code")
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, "package.json"), JSON.stringify({ name: "ax-code", type: "module" }))
}

function harnessSource(agentSpecifier: string) {
  return `
import { createAgent } from ${JSON.stringify(agentSpecifier)}

// The loader captures process.argv[1] and cwd at import time (above). Simulate a
// later chdir and a stale, relative entry so resolution must use the captured
// values instead of re-reading the mutated process state.
const chdirTo = process.env.AX_TEST_CHDIR
if (chdirTo) {
  process.chdir(chdirTo)
  if (process.env.AX_TEST_STALE_ENTRY === "1" && process.argv[1]) {
    process.argv[1] = process.argv[1].split(/[\\\\/]/).pop()
  }
}

try {
  const agent = await createAgent({ directory: "/x" })
  process.stdout.write(JSON.stringify({ ok: true, agent }) + "\\n")
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      message: String(error?.message),
      code: error?.code,
      cause: error?.cause ? { message: String(error.cause.message), code: error.cause.code } : null,
    }) + "\\n",
  )
}
`
}

// Transpile the SDK entry module into a temp ESM directory with NO node_modules
// above it, so runtime-loader's first `import("ax-code/sdk/programmatic")` fails
// with a missing-runtime error and the host fallback is what actually resolves
// the fixture. Keeping the loader in its own directory (separate from every
// fixture) is what proves the fallbacks below run.
async function writeLoaderDir() {
  const loaderDir = await makeTempDir()
  await writeFile(join(loaderDir, "package.json"), JSON.stringify({ type: "module" }))
  for (const name of ["agent", "runtime-loader"]) {
    const source = await readFile(join(sourceDir, `${name}.ts`), "utf8")
    const output = typescript.transpileModule(source, {
      fileName: `${name}.ts`,
      compilerOptions: {
        module: typescript.ModuleKind.ESNext,
        target: typescript.ScriptTarget.ES2022,
        moduleResolution: typescript.ModuleResolutionKind.Bundler,
      },
    }).outputText
    await writeFile(join(loaderDir, `${name}.js`), output)
  }
  return loaderDir
}

// Write the harness into `dir` and import the transpiled loader by absolute URL,
// so the harness location (the child's process.argv[1], which the loader reads)
// is decoupled from where the loader was built.
async function writeHarness(dir: string, loaderDir: string) {
  const harness = join(dir, "harness.mjs")
  await writeFile(harness, harnessSource(pathToFileURL(join(loaderDir, "agent.js")).href))
  return harness
}

// A harness that deletes its own working directory before importing the loader,
// reproducing the ENOENT that `process.cwd()` throws at module evaluation.
async function writeCwdRemovalHarness(dir: string, loaderDir: string) {
  const harness = join(dir, "cwd-removal-harness.mjs")
  await writeFile(
    harness,
    `
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const doomed = await mkdtemp(join(tmpdir(), "ax-code-sdk-doomed-"))
process.chdir(doomed)
await rm(doomed, { recursive: true, force: true })

const agentSpecifier = ${JSON.stringify(pathToFileURL(join(loaderDir, "agent.js")).href)}

let output
try {
  const { createAgent } = await import(agentSpecifier)
  try {
    await createAgent({ directory: "/" })
    output = { ok: true }
  } catch (error) {
    output = {
      ok: false,
      message: String(error?.message),
      cause: error?.cause ? { message: String(error.cause.message), code: error.cause.code } : null,
    }
  }
} catch (error) {
  output = { ok: false, importError: String(error?.message), code: error?.code }
}
process.stdout.write(JSON.stringify(output) + "\\n")
`,
  )
  return harness
}

type HarnessResult =
  | { ok: true; agent: { marker?: string; options?: { directory?: string } } }
  | {
      ok: false
      message: string
      code?: string
      cause: { message: string; code?: string } | null
      // Set instead of message/cause when importing the SDK root itself failed.
      importError?: string
    }

type HarnessOptions = {
  cwd?: string
  nodePath?: string
  chdirTo?: string
  staleEntry?: boolean
}

// Run the harness in a plain Node child process. By default the child strips
// NODE_PATH because the vitest process gets a pnpm virtual-store path there,
// which would make `ax-code` resolvable from every base and hide the host
// fallback. Tests that exercise NODE_PATH set it explicitly.
function runHarness(script: string, options: HarnessOptions = {}): Promise<HarnessResult> {
  return new Promise((resolveResult, reject) => {
    const env = { ...process.env }
    delete env.NODE_PATH
    delete env.NODE_OPTIONS
    delete env.AX_TEST_CHDIR
    delete env.AX_TEST_STALE_ENTRY
    if (options.nodePath !== undefined) env.NODE_PATH = options.nodePath
    if (options.chdirTo !== undefined) env.AX_TEST_CHDIR = options.chdirTo
    if (options.staleEntry) env.AX_TEST_STALE_ENTRY = "1"
    const child = spawn(process.execPath, [script], {
      cwd: options.cwd ?? process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk))
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`harness exited ${code}: ${stderr || stdout}`))
        return
      }
      try {
        resolveResult(JSON.parse(stdout.trim()) as HarnessResult)
      } catch (error) {
        reject(new Error(`invalid harness output: ${stdout}\n${stderr}`, { cause: error }))
      }
    })
  })
}

describe("createAgent runtime loading", () => {
  test("falls back to the current working directory when the SDK cannot resolve ax-code", async () => {
    const fixtureDir = await makeTempDir()
    await writeRuntimeFixture(
      fixtureDir,
      'export async function createAgent(options) { return { marker: "cwd-runtime", options } }\n',
    )
    const loaderDir = await writeLoaderDir()
    // The harness (the child's entry script) lives in the fixture-free loader
    // dir, so only the current working directory can resolve the fixture.
    const harness = await writeHarness(loaderDir, loaderDir)
    process.chdir(fixtureDir)

    const result = await runHarness(harness)

    expect(result).toEqual({
      ok: true,
      agent: { marker: "cwd-runtime", options: { directory: "/x" } },
    })
  })

  test("falls back to the entry script's directory when the SDK and cwd cannot resolve ax-code", async () => {
    const entryDir = await makeTempDir()
    await writeRuntimeFixture(
      entryDir,
      'export async function createAgent(options) { return { marker: "entry-runtime", options } }\n',
    )
    const loaderDir = await writeLoaderDir()
    const emptyCwd = await makeTempDir()
    // The harness sits beside its own node_modules/ax-code fixture and the cwd is
    // empty, so only the entry script's directory can resolve the fixture.
    const harness = await writeHarness(entryDir, loaderDir)
    process.chdir(emptyCwd)

    const result = await runHarness(harness)

    expect(result).toEqual({
      ok: true,
      agent: { marker: "entry-runtime", options: { directory: "/x" } },
    })
  })

  test("ignores a NODE_PATH decoy and resolves the entry fixture", async () => {
    const entryDir = await makeTempDir()
    await writeRuntimeFixture(entryDir, 'export async function createAgent() { return { marker: "entry" } }\n')
    const decoyRoot = await makeTempDir()
    await writeNodePathFixture(decoyRoot, 'export async function createAgent() { return { marker: "decoy" } }\n')
    const emptyCwd = await makeTempDir()
    const loaderDir = await writeLoaderDir()
    const harness = await writeHarness(entryDir, loaderDir)

    const result = await runHarness(harness, { cwd: emptyCwd, nodePath: decoyRoot })

    expect(result).toEqual({ ok: true, agent: { marker: "entry" } })
  })

  test("does not fall back to a NODE_PATH decoy when node_modules/ax-code lacks exports", async () => {
    const fixtureDir = await makeTempDir()
    await writeUnshapedRuntimeFixture(fixtureDir)
    const decoyRoot = await makeTempDir()
    await writeNodePathFixture(decoyRoot, 'export async function createAgent() { return { marker: "decoy" } }\n')
    const loaderDir = await writeLoaderDir()
    const harness = await writeHarness(loaderDir, loaderDir)

    const result = await runHarness(harness, { cwd: fixtureDir, nodePath: decoyRoot })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.importError).toBeUndefined()
    expect(result.message).toMatch(/not published/i)
  })

  test.skipIf(process.platform === "win32")(
    "imports the SDK root when the working directory has been deleted",
    async () => {
      const loaderDir = await writeLoaderDir()
      const harness = await writeCwdRemovalHarness(loaderDir, loaderDir)

      const result = await runHarness(harness, { cwd: loaderDir })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.importError).toBeUndefined()
      expect(result.message).toMatch(/not published/i)
      expect(result.message).not.toMatch(/ENOENT|uv_cwd/)
    },
  )

  test("keeps the captured entry directory after process.chdir()", async () => {
    const entryDir = await makeTempDir()
    await writeRuntimeFixture(entryDir, 'export async function createAgent() { return { marker: "entry" } }\n')
    const emptyCwd = await makeTempDir()
    const loaderDir = await writeLoaderDir()
    const harness = await writeHarness(entryDir, loaderDir)

    const result = await runHarness(harness, { cwd: entryDir, chdirTo: emptyCwd, staleEntry: true })

    expect(result).toEqual({ ok: true, agent: { marker: "entry" } })
  })

  test("propagates a resolution error from a confirmed ax-code package", async () => {
    const entryDir = await makeTempDir()
    await writeRuntimeFixture(entryDir, 'export async function createAgent() { return { marker: "entry" } }\n')
    const cwdDir = await makeTempDir()
    await writeFile(
      join(cwdDir, "package.json"),
      JSON.stringify({ name: "ax-code", type: "module", exports: { "./other": "./other.js" } }),
    )
    const loaderDir = await writeLoaderDir()
    const harness = await writeHarness(entryDir, loaderDir)

    const result = await runHarness(harness, { cwd: cwdDir })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED")
    expect(result.message).toMatch(/sdk\/programmatic|exports/)
  })

  test("reports an accurate missing-runtime error with headless and grpc guidance", async () => {
    const loaderDir = await writeLoaderDir()
    const emptyCwd = await makeTempDir()
    const harness = await writeHarness(loaderDir, loaderDir)
    process.chdir(emptyCwd)

    const result = await runHarness(harness)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain("headless")
    expect(result.message).toContain("grpc")
    expect(result.message).toMatch(/not published/i)
    expect(result.message).not.toMatch(/install/i)
    expect(result.message).toContain("register-node.ts")
    expect(result.message).toContain("pnpm --dir packages/ax-code exec tsx --import ./script/register-node.ts")
    expect(result.cause).not.toBeNull()
  })

  test("propagates a transitive module-not-found instead of rewriting it", async () => {
    const fixtureDir = await makeTempDir()
    await writeRuntimeFixture(
      fixtureDir,
      'import "definitely-missing-pkg-for-test"\nexport async function createAgent() { return {} }\n',
    )
    const loaderDir = await writeLoaderDir()
    const harness = await writeHarness(loaderDir, loaderDir)
    process.chdir(fixtureDir)

    const result = await runHarness(harness)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain("definitely-missing-pkg-for-test")
    expect(result.message).not.toContain("not published")
  })
})

describe("isMissingAxCodeRuntimeError", () => {
  function moduleNotFound(message: string, code = "ERR_MODULE_NOT_FOUND") {
    return Object.assign(new Error(message), { code })
  }

  test("matches a missing ax-code package or ax-code subpath", () => {
    expect(isMissingAxCodeRuntimeError(moduleNotFound("Cannot find package 'ax-code' imported from /a.js"))).toBe(true)
    expect(isMissingAxCodeRuntimeError(moduleNotFound("Cannot find module 'ax-code/sdk/programmatic'"))).toBe(true)
  })

  test("does not match other missing modules that merely mention ax-code", () => {
    expect(
      isMissingAxCodeRuntimeError(
        moduleNotFound("Cannot find package '@ax-code/plugin' imported from /Users/x/ax-code/a.js"),
      ),
    ).toBe(false)
    expect(
      isMissingAxCodeRuntimeError(
        moduleNotFound(
          "Cannot find package 'definitely-missing-pkg-for-test' imported from /x/ax-code/src/sdk/programmatic.js",
        ),
      ),
    ).toBe(false)
  })

  test("requires a module-not-found error code", () => {
    expect(isMissingAxCodeRuntimeError(moduleNotFound("Cannot find package 'ax-code'", "OTHER"))).toBe(false)
  })
})
