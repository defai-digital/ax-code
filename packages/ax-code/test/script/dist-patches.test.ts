import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, expect, test } from "vitest"
import { overlayDistributionPatches } from "../../script/dist-patches"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

test("standalone distributions retain patches declared in pnpm-workspace.yaml", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ax-dist-patches-"))
  roots.push(root)
  const write = (file: string, content: string): void => {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  write("package.json", '{"private":true}')
  write(
    "pnpm-workspace.yaml",
    'patchedDependencies:\n  "node-pty-prebuilt-multiarch@0.10.1-pre.5": patches/pty.patch\n  "@scope/example@1.0.0": patches/scoped.patch\n  "unshipped@1.0.0": patches/missing.patch\n',
  )
  write("patches/pty.patch", "+++ b/scripts/install.js\n")
  write("patches/scoped.patch", "+++ b/index.js\n")
  write("workspace/node-pty-prebuilt-multiarch/scripts/install.js", "patched PTY\n")
  write("workspace/@scope/example/index.js", "patched scoped package\n")
  write("dist/node_modules/node-pty-prebuilt-multiarch/scripts/install.js", "registry PTY\n")
  const patches = overlayDistributionPatches({
    repoRoot: root,
    workspaceNodeModules: path.join(root, "workspace"),
    distributionRoot: path.join(root, "dist"),
    dependencies: { "node-pty-prebuilt-multiarch": "0.10.1-pre.5", "@scope/example": "1.0.0" },
  })
  expect(patches).toEqual(["node-pty-prebuilt-multiarch", "@scope/example"])
  expect(
    fs.readFileSync(path.join(root, "dist/node_modules/node-pty-prebuilt-multiarch/scripts/install.js"), "utf8"),
  ).toBe("patched PTY\n")
  expect(fs.readFileSync(path.join(root, "dist/node_modules/@scope/example/index.js"), "utf8")).toBe(
    "patched scoped package\n",
  )
})
