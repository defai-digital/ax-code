import { describe, expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const desktopRoot = path.resolve(import.meta.dirname, "..")
const script = path.join(desktopRoot, "scripts/minisign-keygen.sh")

describe("minisign-keygen.sh", () => {
  test("creates the ax.sec backing key, compatibility symlink, and ax.pub", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-minisign-keygen-test-"))
    try {
      const bin = path.join(dir, "bin")
      const keyDir = path.join(dir, "signkey")
      fs.mkdirSync(bin)
      const fakeMinisign = path.join(bin, "minisign")
      fs.writeFileSync(
        fakeMinisign,
        `#!/usr/bin/env bash
set -euo pipefail
secret=""
public=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -s) secret="$2"; shift 2 ;;
    -p) public="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf 'untrusted comment: minisign encrypted secret key\nsecret\n' > "$secret"
printf 'untrusted comment: minisign public key CF42FC69BEEF0EA5\npublic\n' > "$public"
`,
        { mode: 0o755 },
      )

      const result = spawnSync("bash", [script, "--key-dir", keyDir, "--allow-unencrypted-test-key"], {
        cwd: desktopRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` },
      })

      expect(result.status).toBe(0)
      expect(fs.readlinkSync(path.join(keyDir, "ax.minisign.key"))).toBe("ax.sec")
      expect(fs.statSync(path.join(keyDir, "ax.sec")).mode & 0o777).toBe(0o600)
      expect(fs.statSync(path.join(keyDir, "ax.pub")).mode & 0o777).toBe(0o644)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
