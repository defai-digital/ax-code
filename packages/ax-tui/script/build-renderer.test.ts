import { spawnSync } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const root = fileURLToPath(new URL("../", import.meta.url))

test("renderer build resolves Solid against newly staged core declarations, not stale package exports", async () => {
  await mkdir(path.join(root, ".internal"), { recursive: true })
  const fixture = await mkdtemp(path.join(root, ".internal/declaration-build-"))
  try {
    await Promise.all([
      ...["src", "solid", "native/source"].map((name) =>
        cp(path.join(root, name), path.join(fixture, name), { recursive: true }),
      ),
      ...["package.json", "tsconfig.json", "tsconfig.build.json", "script/build-renderer.ts",
        "native/tsconfig.json", "native/tsconfig.build.json"].map((name) =>
        cp(path.join(root, name), path.join(fixture, name)),
      ),
      symlink(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "junction"),
    ])
    for (const name of await readdir(path.join(root, "native"))) {
      if (name.endsWith(".d.ts")) await cp(path.join(root, "native", name), path.join(fixture, "native", name))
    }
    // Deliberately simulate a previous distribution which knows nothing about the current API.
    await writeFile(path.join(fixture, "index.d.ts"), "export {}\n")
    await writeFile(path.join(fixture, "testing.d.ts"), "export {}\n")
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "script/build-renderer.ts", "output"], {
      cwd: fixture, encoding: "utf8", timeout: 45_000,
    })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const declarations = await readFile(path.join(fixture, "output/solid/src/elements/hooks.d.ts"), "utf8")
    expect(declarations).toContain("useOverlay")
    expect(declarations).toContain("OverlayHandle")
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
}, 60_000)
