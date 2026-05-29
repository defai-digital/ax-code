import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"

export type DesktopBuildArtifacts = {
  outDir: string
  mainPath: string
  preloadPath: string
  appDist: string
  appIndexPath: string
}

export async function buildDesktopArtifacts(
  input: {
    outDir?: string
    appDist?: string
    clean?: boolean
  } = {},
): Promise<DesktopBuildArtifacts> {
  const root = path.resolve(import.meta.dirname, "../..")
  const outDir = input.outDir ?? path.join(root, "dist")
  const sourceAppDist = input.appDist ?? path.resolve(root, "../app/dist")
  const packagedAppDist = path.join(outDir, "app")
  if (!existsSync(path.join(sourceAppDist, "index.html"))) {
    throw new Error(`Renderer build is missing: ${path.join(sourceAppDist, "index.html")}`)
  }

  if (input.clean ?? true) rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const result = await Bun.build({
    entrypoints: [path.join(root, "src/main.ts")],
    outdir: outDir,
    target: "node",
    format: "esm",
    // Electron is provided by the host runtime; app dependencies must be bundled into main.js.
    external: ["electron"],
    sourcemap: "external",
  })
  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join("\n")
    throw new Error(`Desktop main build failed${messages ? `:\n${messages}` : ""}`)
  }

  const preloadPath = path.join(outDir, "preload.cjs")
  cpSync(path.join(root, "src/preload.cjs"), preloadPath)
  cpSync(sourceAppDist, packagedAppDist, { recursive: true })

  const artifacts = {
    outDir,
    mainPath: path.join(outDir, "main.js"),
    preloadPath,
    appDist: packagedAppDist,
    appIndexPath: path.join(packagedAppDist, "index.html"),
  }
  for (const file of [artifacts.mainPath, artifacts.preloadPath, artifacts.appIndexPath]) {
    if (!existsSync(file)) throw new Error(`Desktop build artifact is missing: ${file}`)
  }
  return artifacts
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "out-dir": { type: "string" },
      "app-dist": { type: "string" },
      clean: { type: "boolean", default: true },
    },
    strict: true,
    allowPositionals: false,
  })
  const artifacts = await buildDesktopArtifacts({
    outDir: values["out-dir"],
    appDist: values["app-dist"],
    clean: values.clean,
  })
  console.log(JSON.stringify(artifacts, null, 2))
}
