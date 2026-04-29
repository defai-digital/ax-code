#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import solidPlugin from "@opentui/solid/bun-plugin"
import { formatModelsSnapshot, preserveLocalProviders } from "./models-snapshot"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import pkg from "../package.json"
import { scopePackageName } from "./package-names"
import { compiledBunfsModulePath } from "./embedded-path"
import { collectBuildDependencyPackages, resolveInstalledPackagePath } from "./build-deps"

const modelsUrl = process.env.AX_CODE_MODELS_URL || "https://models.dev"
const snapshotPath = path.join(dir, "src/provider/models-snapshot.json")
if (process.env.MODELS_DEV_API_JSON || process.env.AX_CODE_UPDATE_MODELS === "1") {
  // Explicit refresh path only. Enterprise/offline builds should use the
  // committed, reviewed snapshot instead of live upstream data.
  const modelsData = process.env.MODELS_DEV_API_JSON
    ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
    : await fetch(`${modelsUrl}/api.json`).then((x) => x.text())
  const existingSnapshot = JSON.parse(
    await Bun.file(snapshotPath)
      .text()
      .catch(() => "{}"),
  )
  const fetched = JSON.parse(modelsData)
  await Bun.write(snapshotPath, formatModelsSnapshot(preserveLocalProviders(fetched, existingSnapshot)))
  console.log("Generated models-snapshot.json")
} else {
  console.log("Using committed models-snapshot.json")
}

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const includeAbiFlag = process.argv.includes("--include-abi")
const skipInstall = process.argv.includes("--skip-install")

function buildChannelForVersion(version: string) {
  const prerelease = version.split("-", 2)[1]
  if (!prerelease) return "latest"
  return prerelease.split(".", 1)[0] || "beta"
}

const buildVersion = (process.env.AX_CODE_VERSION ?? pkg.version).replace(/^v/, "")
const buildChannel = process.env.AX_CODE_CHANNEL ?? buildChannelForVersion(buildVersion)
const buildInfo = {
  channel: buildChannel,
  version: buildVersion,
  preview: buildChannel !== "latest",
  release: process.env.AX_CODE_RELEASE === "1" || process.env.AX_CODE_RELEASE === "true",
}

console.log("ax-code build", JSON.stringify(buildInfo, null, 2))

async function exists(target: string) {
  return fs.promises
    .access(target)
    .then(() => true)
    .catch(() => false)
}

async function cleanupBunBuildArtifacts() {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(".") && entry.name.endsWith(".bun-build"))
      .map((entry) => fs.promises.rm(path.join(dir, entry.name), { force: true })),
  )
}

async function materializePackage(target: string, sources: string[]) {
  for (const source of sources) {
    if (!(await exists(source))) continue
    const resolvedSource = await fs.promises.realpath(source).catch(() => source)
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.rm(target, { recursive: true, force: true })
    await fs.promises.cp(resolvedSource, target, { recursive: true })
    return true
  }
  return false
}

async function ensurePackageTargets(targets: string[], sources: string[]) {
  const availableSources = [...sources]

  for (const target of targets) {
    if (await exists(target)) {
      availableSources.unshift(target)
      continue
    }
    const copied = await materializePackage(target, availableSources)
    if (!copied) return false
    availableSources.unshift(target)
  }

  return true
}

async function ensureBuildDependencies(targets: { os: string; arch: string }[]) {
  const localNodeModules = path.join(dir, "node_modules")
  const repoRoot = path.resolve(dir, "../..")
  const repoNodeModules = path.join(repoRoot, "node_modules")
  const repoStoreNodeModules = path.join(repoNodeModules, ".pnpm", "node_modules")
  const opentuiPackage = JSON.parse(await Bun.file(path.join(localNodeModules, "@opentui/core/package.json")).text())
  const requiredPackages = collectBuildDependencyPackages(
    opentuiPackage.optionalDependencies,
    pkg.devDependencies,
    targets,
  )
  const missingPackages = []

  for (const dependency of requiredPackages) {
    const targetPaths = [
      resolveInstalledPackagePath(repoStoreNodeModules, dependency.name),
      resolveInstalledPackagePath(localNodeModules, dependency.name),
    ]
    const hydrated = await ensurePackageTargets(targetPaths, [
      resolveInstalledPackagePath(repoStoreNodeModules, dependency.name),
      resolveInstalledPackagePath(localNodeModules, dependency.name),
      resolveInstalledPackagePath(repoNodeModules, dependency.name),
    ])
    if (!hydrated) {
      missingPackages.push(dependency)
    }
  }

  if (missingPackages.length === 0) return

  const tempRoot = path.join(dir, ".tmp", "build-deps")
  const tempNodeModules = path.join(tempRoot, "node_modules")
  const tempDir = path.join(tempRoot, "tmp")
  const cacheDir = path.join(tempRoot, "cache")

  await fs.promises.rm(tempRoot, { recursive: true, force: true })
  await fs.promises.mkdir(tempRoot, { recursive: true })
  await fs.promises.mkdir(tempDir, { recursive: true })
  await fs.promises.mkdir(cacheDir, { recursive: true })
  await Bun.write(
    path.join(tempRoot, "package.json"),
    JSON.stringify(
      {
        name: "ax-code-build-deps",
        private: true,
      },
      null,
      2,
    ),
  )

  const previousEnv = {
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
    BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR,
  }

  Object.assign(process.env, {
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
    BUN_INSTALL_CACHE_DIR: cacheDir,
  })

  try {
    await $`bun add --os="*" --cpu="*" ${missingPackages.map((item) => `${item.name}@${item.version}`)}`.cwd(tempRoot)
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  for (const dependency of missingPackages) {
    const copied = await ensurePackageTargets(
      [
        resolveInstalledPackagePath(repoStoreNodeModules, dependency.name),
        resolveInstalledPackagePath(localNodeModules, dependency.name),
      ],
      [
        resolveInstalledPackagePath(tempNodeModules, dependency.name),
        resolveInstalledPackagePath(repoStoreNodeModules, dependency.name),
        resolveInstalledPackagePath(localNodeModules, dependency.name),
        resolveInstalledPackagePath(repoNodeModules, dependency.name),
      ],
    )
    if (!copied) {
      throw new Error(`Failed to materialize build dependency ${dependency.name}`)
    }
  }
}

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // ABI-specific variants are opt-in even for the native OS/CPU.
      if (item.abi !== undefined && !includeAbiFlag) {
        return false
      }

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      return true
    })
  : allTargets

if (targets.length === 0) {
  throw new Error("No build targets selected")
}

await $`rm -rf dist`

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await ensureBuildDependencies(targets)
}
for (const item of targets) {
  const legacyName = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  const packageName = scopePackageName(legacyName)
  console.log(`building ${packageName}`)
  await $`mkdir -p dist/${legacyName}/bin`

  const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
  const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
  const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
  const workerPath = "./src/cli/cmd/tui/worker.ts"

  // Use platform-specific bunfs root path based on target OS
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
  const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

  await cleanupBunBuildArtifacts()
  try {
    await Bun.build({
      conditions: ["browser"],
      tsconfig: "./tsconfig.json",
      plugins: [solidPlugin],
      compile: {
        autoloadBunfig: false,
        autoloadDotenv: false,
        autoloadTsconfig: true,
        autoloadPackageJson: true,
        target: legacyName.replace(pkg.name, "bun") as any,
        outfile: `dist/${legacyName}/bin/ax-code`,
        execArgv: [`--user-agent=ax-code/${buildVersion}`, "--use-system-ca", "--"],
        windows: {},
      },
      // The compiled binary receives already-transformed JSX from the build
      // plugin. Use an entrypoint without the source/dev OpenTUI preload so
      // Bun compile does not bundle Babel's transform-time dependency graph
      // into standalone binaries.
      entrypoints: ["./src/index-compiled.ts", parserWorker, workerPath],
      define: {
        AX_CODE_VERSION: `'${buildVersion}'`,
        AX_CODE_MIGRATIONS: JSON.stringify(migrations),
        OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
        AX_CODE_WORKER_PATH: compiledBunfsModulePath(bunfsRoot, workerPath),
        AX_CODE_CHANNEL: `'${buildChannel}'`,
        AX_CODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
      },
    })
  } finally {
    await cleanupBunBuildArtifacts()
  }

  const binaryPath = `dist/${legacyName}/bin/ax-code`

  if (item.os === "darwin" && process.platform === "darwin") {
    try {
      await $`codesign --remove-signature ${binaryPath}`
    } catch {
      // Some Bun outputs have no signature to remove.
    }
    await $`codesign --force --sign - ${binaryPath}`
    await $`codesign --verify --verbose=4 ${binaryPath}`
  }

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${packageName}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${legacyName}/bin/tui`
  await Bun.file(`dist/${legacyName}/package.json`).write(
    JSON.stringify(
      {
        name: packageName,
        version: buildVersion,
        os: [item.os],
        cpu: [item.arch],
        publishConfig: {
          access: "public",
        },
      },
      null,
      2,
    ),
  )
  binaries[packageName] = buildVersion
}

if (buildInfo.release) {
  for (const key of Object.keys(binaries)) {
    const legacyName = key.replace(/^@[^/]+\//, "")
    if (legacyName.includes("linux")) {
      await $`tar -czf ../../${legacyName}.tar.gz *`.cwd(`dist/${legacyName}/bin`)
    } else if (legacyName.includes("windows")) {
      const src = path.resolve(`dist/${legacyName}/bin`)
      const dest = path.resolve(`dist/${legacyName}.zip`)
      await $`powershell -Command "Compress-Archive -Path '${src}/*' -DestinationPath '${dest}' -Force"`
    } else {
      await $`zip -r ../../${legacyName}.zip *`.cwd(`dist/${legacyName}/bin`)
    }
  }
  // Archive upload is handled by the CI workflow's "Upload release assets" step.
  // The build script only creates the archives; the workflow uploads them after
  // all platform runners finish and artifacts are collected.
}

export { binaries }
