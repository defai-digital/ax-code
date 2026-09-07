import { spawnSync } from "node:child_process"
import type { SpawnSyncReturns } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"

const installer = path.resolve(import.meta.dirname, "../install")

interface Fixture {
  root: string
  source: string
  installed: string
  result: SpawnSyncReturns<string>
}

async function runInstaller(hooks: string, check: (fixture: Fixture) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ax-code-unix-installer-test-"))
  try {
    const source = path.join(root, "source bundle")
    const installed = path.join(root, "installed bundle")
    const files = {
      "bin/ax-code": '#!/bin/sh\nprintf "8.8.8\\n"\n',
      "lib/index-node-tui.js": 'import { version } from "solid-js/dist/solid.js"; console.log(version)\n',
      "node/bin/node": '#!/bin/sh\nif [ "$1" = "--experimental-ffi" ]; then shift; fi\nexec "$AX_TEST_NODE" "$@"\n',
      "node_modules/solid-js/package.json": JSON.stringify({ type: "module" }),
      "node_modules/solid-js/dist/solid.js": 'export const version = "9.9.9"\n',
      "package.json": JSON.stringify({ type: "module" }),
    }
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(source, relative)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content)
    }
    await chmod(path.join(source, "node/bin/node"), 0o755)
    await chmod(path.join(source, "bin/ax-code"), 0o755)
    await cp(source, installed, { recursive: true })
    await writeFile(path.join(installed, "node_modules/solid-js/dist/solid.js"), 'export const version = "8.8.8"\n')
    await writeFile(path.join(installed, "lib/obsolete.js"), "previous runtime\n")
    await writeFile(path.join(installed, "config.json"), "user configuration\n")

    const text = await readFile(installer, "utf8")
    const functions = path.join(root, "functions.sh")
    await writeFile(
      functions,
      text.slice(text.indexOf("write_node_bundle_launcher() {"), text.indexOf("warn_path_precedence() {")),
    )
    const script = path.join(root, "test.sh")
    await writeFile(
      script,
      `#!/usr/bin/env bash
set -euo pipefail
source "$AX_TEST_FUNCTIONS"
INSTALL_ROOT="$AX_TEST_INSTALLED"
INSTALL_DIR="$INSTALL_ROOT/bin"
INSTALL_LIB_DIR="$INSTALL_ROOT/lib"
INSTALL_NODE_DIR="$INSTALL_ROOT/node"
INSTALL_NODE_MODULES_DIR="$INSTALL_ROOT/node_modules"
INSTALL_PACKAGE_JSON="$INSTALL_ROOT/package.json"
specific_version=9.9.9
RED='' NC='' ORANGE=''
print_message() { printf '%s: %s\\n' "$1" "$2"; }
${hooks}
install_node_bundle_tree "$AX_TEST_SOURCE"
verify_installed_binary
printf 'INSTALL_COMPLETED\\n'
`,
    )
    const result = spawnSync("bash", [script], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        AX_TEST_FUNCTIONS: functions,
        AX_TEST_SOURCE: source,
        AX_TEST_INSTALLED: installed,
        AX_TEST_NODE: process.execPath,
      },
    })
    expect(result.error).toBeUndefined()
    await check({ root, source, installed, result })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function expectExit(result: SpawnSyncReturns<string>, expected: number) {
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(expected)
}

async function expectPreviousRuntime(fixture: Fixture) {
  const runtime = spawnSync(process.execPath, [path.join(fixture.installed, "lib/index-node-tui.js")], {
    encoding: "utf8",
  })
  expectExit(runtime, 0)
  expect(runtime.stdout.trim()).toBe("8.8.8")
  expect(await readFile(path.join(fixture.installed, "lib/obsolete.js"), "utf8")).toBe("previous runtime\n")
  expect(await readFile(path.join(fixture.installed, "config.json"), "utf8")).toBe("user configuration\n")
  expect(existsSync(path.join(fixture.installed, "bin/ax-code"))).toBe(true)
}

describe.skipIf(process.platform === "win32")("Unix runtime installation", () => {
  test("installs a complete runtime into a new destination", async () => {
    await runInstaller('rm -rf "$INSTALL_ROOT"; mkdir -p "$INSTALL_DIR"', async ({ result }) => {
      expectExit(result, 0)
      expect(result.stdout).toContain("INSTALL_COMPLETED")
    })
  })

  test("replaces a healthy runtime without retaining stale files or modifying user configuration", async () => {
    await runInstaller("", async ({ installed, result }) => {
      expectExit(result, 0)
      expect(result.stdout).toContain("INSTALL_COMPLETED")
      expect(existsSync(path.join(installed, "lib/obsolete.js"))).toBe(false)
      expect(existsSync(path.join(installed, "node_modules/node_modules"))).toBe(false)
      expect(await readFile(path.join(installed, "config.json"), "utf8")).toBe("user configuration\n")
    })
  })

  test("rejects a missing dependency without resolving it from or deleting the previous runtime", async () => {
    await runInstaller('rm -rf "$AX_TEST_SOURCE/node_modules/solid-js"', async (fixture) => {
      expectExit(fixture.result, 1)
      expect(fixture.result.stdout + fixture.result.stderr).toContain("solid-js")
      await expectPreviousRuntime(fixture)
    })
  })

  test("preserves the previous runtime if a file cannot be staged", async () => {
    await runInstaller(
      `cp() {
  if [ "$2" = "$AX_TEST_SOURCE/node_modules" ]; then
    printf 'Simulated copy failure\\n' >&2
    return 1
  fi
  command cp "$@"
}`,
      async (fixture) => {
        expectExit(fixture.result, 1)
        await expectPreviousRuntime(fixture)
      },
    )
  })

  test("rejects an unexpected candidate version before replacing the previous runtime", async () => {
    await runInstaller("specific_version=10.0.0", async (fixture) => {
      expectExit(fixture.result, 1)
      expect(fixture.result.stdout + fixture.result.stderr).toContain("expected '10.0.0'")
      await expectPreviousRuntime(fixture)
    })
  })

  test("restores the previous runtime when launcher validation fails", async () => {
    await runInstaller(
      `mv() {
  command mv "$@" || return
  if [ "$2" = "$INSTALL_DIR/ax-code" ] && [[ "$1" != */previous/* ]]; then
    printf '#!/bin/sh\\necho 7.7.7\\n' > "$INSTALL_DIR/ax-code"
  fi
}`,
      async (fixture) => {
        expectExit(fixture.result, 1)
        expect(fixture.result.stdout + fixture.result.stderr).toContain("reported '7.7.7'")
        await expectPreviousRuntime(fixture)
      },
    )
  })

  test.each(["backup", "activation"])("restores the previous runtime when %s fails", async (phase) => {
    await runInstaller(
      `mv() {
  if [ "${phase}" = backup ] && [ "$1" = "$INSTALL_NODE_MODULES_DIR" ]; then return 1; fi
  if [ "${phase}" = activation ] && [ "$2" = "$INSTALL_NODE_MODULES_DIR" ] && [[ "$1" != */previous/* ]]; then return 1; fi
  command mv "$@"
}`,
      async (fixture) => {
        expectExit(fixture.result, 1)
        await expectPreviousRuntime(fixture)
      },
    )
  })

  test("restores the previous runtime if the installed entry cannot start", async () => {
    await runInstaller(
      `mv() {
  command mv "$@" || return
  if [ "$2" = "$INSTALL_LIB_DIR" ] && [[ "$1" != */previous/* ]]; then
    printf 'throw new Error("Simulated startup failure")\\n' > "$INSTALL_LIB_DIR/index-node-tui.js"
  fi
}`,
      async (fixture) => {
        expectExit(fixture.result, 1)
        expect(fixture.result.stdout + fixture.result.stderr).toContain("Simulated startup failure")
        await expectPreviousRuntime(fixture)
      },
    )
  })

  test("restores the previous runtime after termination immediately following a move", async () => {
    await runInstaller(
      `mv() {
  command mv "$@" || return
  if [ "$2" = "$INSTALL_NODE_MODULES_DIR" ] && [[ "$1" != */previous/* ]]; then
    "$AX_TEST_NODE" -e "process.kill(process.ppid, 'SIGTERM')"
  fi
}`,
      async (fixture) => {
        expectExit(fixture.result, 143)
        await expectPreviousRuntime(fixture)
      },
    )
  })

  test("retains recovery files when rollback cannot finish", async () => {
    await runInstaller(
      `mv() {
  if [ "$2" = "$INSTALL_NODE_MODULES_DIR" ]; then return 1; fi
  command mv "$@"
}`,
      async (fixture) => {
        expectExit(fixture.result, 1)
        expect(fixture.result.stdout + fixture.result.stderr).toContain("Recovery files remain at")
        const backup = (await readdir(fixture.root)).find((name) => name.startsWith(".ax-code-install."))
        expect(backup).toBeDefined()
        expect(
          await readFile(path.join(fixture.root, backup!, "previous/node_modules/solid-js/dist/solid.js"), "utf8"),
        ).toContain('"8.8.8"')
      },
    )
  })
})
