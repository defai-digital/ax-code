import { afterEach, describe, expect, test } from "vitest"
import { execFile } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { unixNodeLauncherScript } from "../../script/node-launcher"

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

    await execFileAsync(path.join(shimDir, "ax-code"), ["--version"])

    const argumentsText = await readFile(outputPath, "utf8")
    const entryArgument = argumentsText.split("\n").find((argument) => argument.endsWith("/lib/index-node-tui.js"))
    expect(entryArgument).toBeDefined()
    expect(await realpath(entryArgument!)).toBe(await realpath(libEntry))
    expect(argumentsText).not.toContain(path.join(root, ".rbenv", "lib"))
    expect(argumentsText).toContain("--version")
  })
})
