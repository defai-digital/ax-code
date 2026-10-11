import { describe, expect, test } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const checker = path.resolve(import.meta.dirname, "check-release-content.py")

describe("runtime archive content policy", () => {
  test.each(["zip", "tar.gz"])("checks %s archives without extraction and preserves dependencies", (format) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ax-release-content-"))
    const archive = path.join(directory, `runtime.${format}`)
    try {
      function fixture(extra: [string, string, string][] = [], licenses = true) {
        const entries = [
          ["bin/ax-code", "file", "launcher"],
          ["lib/index-node-tui.js", "file", "bundle"],
          ["package.json", "file", "{}"],
          ["runtime-manifest.json", "file", "{}"],
          ["node_modules/example/src/index.ts", "file", "approved dependency source"],
          ["node_modules/example/index.js.map", "file", "approved dependency map"],
          ["node_modules/.bin/example", "symlink", "../example/src/index.ts"],
          ...(licenses ? ["LICENSE", "LICENSE-MIT", "NOTICE"].map((name) => [name, "file", "license"]) : []),
          ...extra,
        ]
        execFileSync("python3", [
          "-c",
          `
import io, json, stat, sys, tarfile, zipfile
entries=json.loads(sys.argv[3])
if sys.argv[2]=='zip':
 with zipfile.ZipFile(sys.argv[1], 'w') as z:
  for name,kind,data in entries:
   item=zipfile.ZipInfo(name)
   item.create_system=3
   item.external_attr=((stat.S_IFLNK if kind=='symlink' else stat.S_IFREG)|0o644)<<16
   z.writestr(item,data)
else:
 with tarfile.open(sys.argv[1], 'w:gz') as z:
  for name,kind,data in entries:
   item=tarfile.TarInfo(name)
   if kind in {'symlink','hardlink'}:
    item.type=tarfile.SYMTYPE if kind=='symlink' else tarfile.LNKTYPE; item.linkname=data; z.addfile(item)
   else:
    raw=data.encode(); item.size=len(raw); z.addfile(item,io.BytesIO(raw))
`,
          archive,
          format,
          JSON.stringify(entries),
        ])
      }
      const check = (required = true) =>
        spawnSync("python3", [checker, ...(required ? ["--require-licenses"] : []), archive], { encoding: "utf8" })
      fixture()
      const hash = fs.readFileSync(archive)
      expect(check().status).toBe(0)
      expect(fs.readFileSync(archive)).toEqual(hash)
      for (const [name, kind, data] of [
        ["packages/ax-code/src/index.ts", "file", "private"],
        ["lib/index-node-tui.js.map", "file", "private"],
        ["node_modules/example/.git/config", "file", "private"],
        ["node_modules/example/.env", "file", "private"],
        ["node_modules/example/data.pem", "file", ["-----BEGIN", "PRIVATE KEY-----\nfixture"].join(" ")],
        ["node_modules/@ax-code/fs/src/index.ts", "file", "private implementation"],
        ["node_modules/@ax-code/fs/index.js.map", "file", "private source map"],
        ["node_modules/example/.GIT/config", "file", "private"],
        [".internal/prd/plan.md", "file", "private"],
        ["../outside", "file", "private"],
        ["lib/INDEX-NODE-TUI.js", "file", "duplicate"],
        ["node_modules/example/escape", "symlink", "../../../outside"],
        ["node_modules/example/absolute", "symlink", "/tmp/outside"],
        ["node_modules/example/cycle", "symlink", "cycle"],
        ["node_modules/example/dangling", "symlink", "missing"],
      ]) {
        fixture([[name, kind, data]])
        const result = check()
        expect(result.status, `${name}: ${result.stderr}`).not.toBe(0)
      }
      fixture([
        ["node_modules/example/alias", "symlink", "../.."],
        ["node_modules/example/escape", "symlink", "alias/../outside"],
      ])
      expect(check().status).not.toBe(0)
      if (format === "tar.gz") {
        fixture([["node_modules/example/hardlink", "hardlink", "lib/index-node-tui.js"]])
        expect(check().status).toBe(0)
        fixture([["node_modules/example/hardlink", "hardlink", "../../../outside"]])
        expect(check().status).not.toBe(0)
      }
      fixture([], false)
      expect(check().status).not.toBe(0)
      expect(check(false).status).toBe(0) // Historical signed releases remain immutable.
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
