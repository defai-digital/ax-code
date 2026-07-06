import { describe, expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")
const desktopReleaseWorkflow = path.join(repoRoot, ".github/workflows/desktop-release.yml")
const sdkBuildScript = path.join(repoRoot, "packages/sdk/js/script/build.ts")

describe("desktop release workflow", () => {
  test("build jobs generate the SDK before packaging Desktop artifacts", async () => {
    const text = await readFile(desktopReleaseWorkflow, "utf-8")

    for (const jobName of ["package-web", "build-macos", "build-windows"]) {
      const nextJob =
        jobName === "package-web" ? "build-macos" : jobName === "build-macos" ? "build-windows" : "sign-release-assets"
      const job = text.match(new RegExp(`  ${jobName}:[\\s\\S]*?(?=\\n  ${nextJob}:|$)`))
      expect(job, `${jobName} job should exist`).not.toBeNull()
      expect(job![0]).toContain("pnpm --dir packages/sdk/js run build")
      expect(job![0].indexOf("pnpm --dir packages/sdk/js run build")).toBeLessThan(
        job![0].indexOf(
          jobName === "package-web" ? "pnpm run desktop:build" : "pnpm --filter @ax-code/electron run build",
        ),
      )
    }
  })

  test("SDK build script avoids platform-specific .bin shims", async () => {
    const text = await readFile(sdkBuildScript, "utf-8")

    expect(text).toContain('packageBin("typescript", "tsc")')
    expect(text).toContain("process.execPath")
    expect(text).not.toContain("node_modules/.bin")
    expect(text).not.toContain('node_modules", ".bin"')
  })

  test("SDK build script serializes shared generated outputs", async () => {
    const text = await readFile(sdkBuildScript, "utf-8")
    const lock = text.indexOf("const releaseBuildLock = await acquireBuildLock()")
    const tmp = text.indexOf('await fs.mkdir(path.join(tmp, "data")')
    const openapi = text.indexOf('toFile: path.join(dir, "openapi.json")')
    const client = text.indexOf('await generateClient("./src/gen")')
    const cleanup = text.indexOf("await releaseBuildLock()")

    expect(lock).toBeGreaterThan(-1)
    expect(tmp).toBeGreaterThan(lock)
    expect(openapi).toBeGreaterThan(lock)
    expect(client).toBeGreaterThan(lock)
    expect(cleanup).toBeGreaterThan(client)
  })

  test("signing job falls back to the shared minisign release secrets", async () => {
    const text = await readFile(desktopReleaseWorkflow, "utf-8")
    const job = text.match(/  sign-release-assets:[\s\S]*?(?=\n  finalize-release:|$)/)

    expect(job, "sign-release-assets job should exist").not.toBeNull()
    expect(job![0]).toContain(
      "secrets.AX_CODE_DESKTOP_MINISIGN_SECRET_KEY_B64 || secrets.AX_CODE_MINISIGN_SECRET_KEY_B64",
    )
    expect(job![0]).toContain("secrets.AX_CODE_DESKTOP_MINISIGN_PASSWORD || secrets.AX_CODE_MINISIGN_PASSWORD")
    expect(job![0]).toContain("Install minisign")
    expect(job![0]).toContain("cp install.ps1 release-assets/install.ps1")
    expect(job![0]).toContain("Sign release assets")
    expect(job![0]).toContain("gh release upload")
    expect(job![0]).toContain("release-assets/install.ps1")
  })
})
