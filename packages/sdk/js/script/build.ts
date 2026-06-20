import { fileURLToPath, pathToFileURL } from "url"
import { spawn } from "child_process"
import { createRequire } from "module"
import { createWriteStream } from "fs"
import fs from "fs/promises"
import path from "path"
import { createClient } from "@hey-api/openapi-ts"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(dir, "../../..")
const axCodeDir = path.resolve(dir, "../../ax-code")
const solidLoader = pathToFileURL(path.join(repoRoot, "script", "solid-loader.mjs")).href
const tsxLoader = pathToFileURL(require.resolve("tsx")).href

// Resolve a local CLI (tsc/prettier) from node_modules/.bin so this runs under
// plain node (no Bun, no global tooling).
function bin(name: string) {
  return path.join(dir, "node_modules", ".bin", name)
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

const tmp = path.join(dir, ".tmp", "xdg")

try {
  await fs.mkdir(path.join(tmp, "data"), { recursive: true })
  await fs.mkdir(path.join(tmp, "config"), { recursive: true })
  await fs.mkdir(path.join(tmp, "cache"), { recursive: true })
  await fs.mkdir(path.join(tmp, "state"), { recursive: true })

  await run(bin("tsc"), ["--build", "--force"])

  // Generate the OpenAPI document by running ax-code's CLI under Node. The Node
  // entry is src/index-node-tui.ts (src/index.ts imports the Bun-only
  // @opentui/solid/preload); tsx strips TS, the solid loader transforms JSX, and
  // TSX_TSCONFIG_PATH lets tsx resolve ax-code's @/* aliases.
  await run(
    process.execPath,
    [
      "--experimental-ffi",
      "--disable-warning=ExperimentalWarning",
      "--import",
      tsxLoader,
      "--import",
      solidLoader,
      "--conditions=node",
      path.join(axCodeDir, "src", "index-node-tui.ts"),
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

  await run(bin("prettier"), ["--write", "src/gen"])
  await run(bin("prettier"), ["--write", "src/v2"])
  await fs.rm(path.join(dir, "dist"), { recursive: true, force: true })
  await run(bin("tsc"), ["--build", "--force"])
  await fs.cp(path.resolve(dir, "../proto"), path.join(dir, "dist", "proto"), { recursive: true })
  await fs.rm(path.join(dir, "openapi.json"), { force: true })
} finally {
  await fs.rm(path.join(dir, ".tmp"), { recursive: true, force: true })
}
