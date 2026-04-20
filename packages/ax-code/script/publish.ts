#!/usr/bin/env bun
import { $ } from "bun"
import path from "path"
import pkg from "../package.json"
import { Script } from "@ax-code/script"
import { fileURLToPath } from "url"
import { META_PACKAGE_NAME } from "./package-names"
import { collectBinaryPublishTargets } from "./publish-plan"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const binaryTargets = collectBinaryPublishTargets(
  await Promise.all(
    [...new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })].map(async (filepath) => {
      const binaryPkg = await Bun.file(`./dist/${filepath}`).json()
      return {
        manifestPath: filepath,
        packageName: binaryPkg.name,
        version: binaryPkg.version,
      }
    }),
  ),
  pkg.name,
)

const binaries = Object.fromEntries(binaryTargets.map((target) => [target.packageName, target.version]))
console.log("binaries", binaries)
const versions = new Set(binaryTargets.map((target) => target.version))
if (versions.size === 0) {
  throw new Error("No platform binary packages found in ./dist")
}
if (versions.size > 1) {
  throw new Error(`Platform binary package versions do not match: ${Array.from(versions).join(", ")}`)
}
const version = [...versions][0]!

const npmName = META_PACKAGE_NAME
const distDir = `./dist/${pkg.name}`

await $`mkdir -p ${distDir}`
await $`cp -r ./bin ${distDir}/bin`
await $`cp ./script/postinstall.mjs ${distDir}/postinstall.mjs`
await Bun.file(`${distDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`${distDir}/package.json`).write(
  JSON.stringify(
    {
      name: npmName,
      type: "module",
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      publishConfig: {
        access: "public",
      },
      optionalDependencies: Object.fromEntries(binaryTargets.map((target) => [target.packageName, target.version])),
    },
    null,
    2,
  ),
)

// Publish platform-specific binaries (skip already-published versions)
const tasks = binaryTargets.map(async (target) => {
  const packageDir = path.join("./dist", target.distDir)
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(packageDir)
  }
  await $`pnpm pack`.cwd(packageDir)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(packageDir).catch((err) => {
    const msg = String(err?.stderr ?? err)
    if (msg.includes("previously published") || msg.includes("cannot publish over")) {
      console.warn(`${target.packageName}@${version} already published, skipping`)
    } else {
      throw err
    }
  })
})
await Promise.all(tasks)

// Publish @defai.digital/ax-code (skip if already published)
await $`cd ${distDir} && pnpm pack && npm publish *.tgz --access public --tag ${Script.channel}`.catch((err) => {
  const msg = String(err?.stderr ?? err)
  if (msg.includes("previously published") || msg.includes("cannot publish over")) {
    console.warn(`${npmName}@${version} already published, skipping`)
  } else {
    throw err
  }
})

// Docker image publish — requires buildx with multi-platform support.
// Skip gracefully in CI environments without docker buildx configured.
const image = "ghcr.io/defai-digital/ax-code"
const platforms = "linux/amd64,linux/arm64"
const tags = [`${image}:${version}`, `${image}:${Script.channel}`]
const tagFlags = tags.flatMap((t) => ["-t", t])
await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`.catch((err) => {
  console.warn("docker buildx skipped:", err instanceof Error ? err.message : String(err))
})
