import { describe, expect, test } from "bun:test"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const installScript = path.join(repoRoot, "install")

describe("install script", () => {
  test("quarantines stale source launchers that shadow the packaged binary", async () => {
    const text = await Bun.file(installScript).text()
    expect(text).toContain("cleanup_stale_source_launchers")
    expect(text).toContain("source_launcher_cwd")
    expect(text).toContain('AX_CODE_SOURCE_CWD="')
    expect(text).toContain("bun run --cwd ")
    expect(text).toContain("/packages/ax-code/src/index.ts")
    expect(text).toContain(".stale-source-")
  })

  test("quarantines stale bundled launchers whose target binary is missing", async () => {
    const text = await Bun.file(installScript).text()
    expect(text).toContain("cleanup_stale_bundled_launchers")
    expect(text).toContain("bundled_launcher_target")
    expect(text).toContain(".stale-bundled-")
    expect(text).toContain("/dist/")
  })

  test("warns when the installed binary is not first on PATH", async () => {
    const text = await Bun.file(installScript).text()
    expect(text).toContain("warn_path_precedence")
    expect(text).toContain("your current shell resolves ax-code to")
    expect(text).toContain("export PATH=${INSTALL_DIR}:\\$PATH")
  })
})
