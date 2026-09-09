import { afterEach, describe, expect, test } from "vitest"
import { execFile } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { UNIX_BRAND_AND_EXEC_NODE, unixNodeLauncherScript } from "../../script/node-launcher"

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Unix node launcher", () => {
  test("resolves the bundle root when invoked through an rbenv-style symlink", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-launcher-"))
    temporaryRoots.push(root)
    const installRoot = path.join(root, ".ax-code")
    const binDir = path.join(installRoot, "bin")
    const nodeDir = path.join(installRoot, "node", "bin")
    const libEntry = path.join(installRoot, "lib", "index-node-tui.js")
    const shimDir = path.join(root, ".rbenv", "shims")
    const outputPath = path.join(root, "node-arguments.txt")
    const cacheDir = path.join(root, "cache")

    await Promise.all([
      mkdir(binDir, { recursive: true }),
      mkdir(nodeDir, { recursive: true }),
      mkdir(path.dirname(libEntry), { recursive: true }),
      mkdir(shimDir, { recursive: true }),
    ])
    const launcher = path.join(binDir, "ax-code")
    const fakeNode = path.join(nodeDir, "node")
    await writeFile(launcher, unixNodeLauncherScript())
    await writeFile(fakeNode, `#!/bin/sh\nprintf '%s\\n' "$@" > "${outputPath}"\n`)
    await writeFile(libEntry, "// Test entry point.\n")
    await chmod(launcher, 0o755)
    await chmod(fakeNode, 0o755)
    await symlink(launcher, path.join(shimDir, "ax-code"))

    await execFileAsync(path.join(shimDir, "ax-code"), ["--version"], {
      env: { ...process.env, XDG_CACHE_HOME: cacheDir, AX_CODE_SYSTEM_NODE: "" },
    })

    // Branding must never overwrite the user's real cached runtime.
    const runtimes = await readdir(path.join(cacheDir, "ax-code/libexec"))
    expect(runtimes).toHaveLength(1)
    expect(await readFile(path.join(cacheDir, "ax-code/libexec", runtimes[0], "bin/AX-Code"), "utf8")).toBe(
      await readFile(fakeNode, "utf8"),
    )

    const argumentsText = await readFile(outputPath, "utf8")
    const entryArgument = argumentsText.split("\n").find((argument) => argument.endsWith("/lib/index-node-tui.js"))
    expect(entryArgument).toBeDefined()
    expect(await realpath(entryArgument!)).toBe(await realpath(libEntry))
    expect(argumentsText).not.toContain(path.join(root, ".rbenv", "lib"))
    expect(argumentsText).toContain("--version")
  })

  test.skipIf(process.platform !== "darwin")(
    "concurrent launches keep Homebrew Node libraries available",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-node-concurrent-"))
      temporaryRoots.push(root)
      // Prefer the dynamic Homebrew runtime: static Node binaries cannot expose
      // the missing-libnode startup failure even when a library link disappears.
      const node = await realpath("/opt/homebrew/bin/node").catch(() => process.execPath)
      const launcher = path.join(root, "launcher")
      await writeFile(
        launcher,
        `#!/bin/sh\n${UNIX_BRAND_AND_EXEC_NODE}\nbrand_and_exec_node "$1" -e 'process.stdout.write("ready")'\n`,
        { mode: 0o755 },
      )
      for (let round = 0; round < 4; round++) {
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            execFileAsync(launcher, [node], {
              env: { ...process.env, XDG_CACHE_HOME: path.join(root, "cache") },
              timeout: 10_000,
            }),
          ),
        )
        expect(results.map((result) => result.stdout)).toEqual(Array(8).fill("ready"))
      }
    },
    30_000,
  )

  test("brands the Node binary as AX-Code before exec", () => {
    const script = unixNodeLauncherScript()
    expect(script).toContain("brand_and_exec_node")
    expect(script).toContain('branded="$cache/bin/AX-Code"')
    expect(script).toContain("runtime")
    expect(script).not.toMatch(/^exec node /m)
  })
})
