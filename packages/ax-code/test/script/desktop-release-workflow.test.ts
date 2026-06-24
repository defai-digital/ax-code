import { describe, expect, test } from "vitest"
import path from "path"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")
const desktopReleaseWorkflow = path.join(repoRoot, ".github/workflows/desktop-release.yml")

describe("desktop release workflow", () => {
  test("build jobs generate the SDK before packaging Desktop artifacts", async () => {
    const text = await Bun.file(desktopReleaseWorkflow).text()

    for (const jobName of ["package-web", "build-macos", "build-windows"]) {
      const nextJob = jobName === "package-web" ? "build-macos" : jobName === "build-macos" ? "build-windows" : "sign-release-assets"
      const job = text.match(new RegExp(`  ${jobName}:[\\s\\S]*?(?=\\n  ${nextJob}:|$)`))
      expect(job, `${jobName} job should exist`).not.toBeNull()
      expect(job![0]).toContain("pnpm --dir packages/sdk/js run build")
      expect(job![0].indexOf("pnpm --dir packages/sdk/js run build")).toBeLessThan(
        job![0].indexOf(jobName === "package-web" ? "pnpm run desktop:build" : "pnpm --filter @ax-code/electron run build"),
      )
    }
  })
})
