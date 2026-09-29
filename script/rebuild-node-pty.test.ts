import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
  bundledNodeGypCandidates,
  nodeGypSupportsVisualStudio2026,
  posixNodeGypShim,
  rebuildNodePty,
  selectNodeGyp,
  windowsNodeGypShim,
} from "./rebuild-node-pty.mjs"

const temporary: string[] = []
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "ax-code-node-gyp-test-"))
  temporary.push(dir)
  return dir
}

describe("Visual Studio 2026 node-gyp selection", () => {
  test("accepts node-gyp 12.1 and newer", () => {
    expect(nodeGypSupportsVisualStudio2026("11.5.0")).toBe(false)
    expect(nodeGypSupportsVisualStudio2026("12.0.0")).toBe(false)
    expect(nodeGypSupportsVisualStudio2026("12.1.0")).toBe(true)
    expect(nodeGypSupportsVisualStudio2026("12.4.0")).toBe(true)
    expect(nodeGypSupportsVisualStudio2026("13.0.2")).toBe(true)
    expect(nodeGypSupportsVisualStudio2026("")).toBe(false)
  })

  test("looks beside the Node executable and in the Unix lib layout", () => {
    const candidates = bundledNodeGypCandidates("/opt/node/bin/node")
    expect(candidates[0]).toBe("/opt/node/bin/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js")
    expect(candidates[1]).toBe("/opt/node/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js")
  })

  test("skips a bundled node-gyp that rejects Visual Studio 2026", () => {
    const root = tempDir()
    const execPath = join(root, "bin", "node")
    const [stale, current] = bundledNodeGypCandidates(execPath)
    writePackage(stale, "11.5.0")
    expect(selectNodeGyp({ execPath, env: {} })).toBeUndefined()
    writePackage(current, "12.4.0")
    expect(selectNodeGyp({ execPath, env: {} })).toBe(current)
  })

  test("uses an explicit override before the bundled copy", () => {
    expect(selectNodeGyp({ env: { AX_CODE_NODE_GYP: "/opt/node-gyp.js" }, exists: () => false })).toBe(
      "/opt/node-gyp.js",
    )
  })

  test("finds the node-gyp shipped with this Node", () => {
    const selected = selectNodeGyp()
    expect(selected).toBeTruthy()
    const version = JSON.parse(readFileSync(join(selected!, "..", "..", "package.json"), "utf8")).version
    expect(nodeGypSupportsVisualStudio2026(version)).toBe(true)
  })
})

describe("node-pty rebuild shim", () => {
  test("writes a Windows shim that calls the selected node-gyp", () => {
    expect(windowsNodeGypShim("C:\\node.exe", "C:\\node-gyp.js")).toBe(
      '@echo off\r\n"C:\\node.exe" "C:\\node-gyp.js" %*\r\n',
    )
    expect(posixNodeGypShim("/usr/bin/node", "/opt/node-gyp.js")).toContain('exec "/usr/bin/node" "/opt/node-gyp.js"')
  })

  test("runs node-pty install.js with the shim ahead of PATH", () => {
    const root = tempDir()
    const gyp = join(root, "node-gyp", "bin", "node-gyp.js")
    const pty = join(root, "node-pty")
    writePackage(gyp, "12.4.0")
    mkdirSync(join(pty, "scripts"), { recursive: true })
    writeFileSync(join(pty, "scripts", "install.js"), "process.exit(0)\n")
    const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = []
    rebuildNodePty({
      execPath: "/usr/bin/node",
      ptyDir: pty,
      env: { PATH: "/usr/bin", AX_CODE_NODE_GYP: gyp },
      platform: "win32",
      spawn: ((command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        calls.push({ command, args, env: options.env })
        const shimDir = options.env.Path?.split(delimiter)[0]
        expect(shimDir).toBeTruthy()
        const shim = join(shimDir!, "node-gyp.cmd")
        expect(readFileSync(shim, "utf8")).toContain(gyp)
        return { status: 0 }
      }) as never,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.command).toBe("/usr/bin/node")
    expect(calls[0]!.args).toEqual([join(pty, "scripts", "install.js")])
    expect(calls[0]!.env.npm_config_node_gyp).toBe(gyp)
  })

  test("windows runtime job does not rebuild through pnpm's node-gyp", () => {
    const ci = readFileSync(".github/workflows/ax-code-ci.yml", "utf8")
    const job = ci.slice(ci.indexOf("  windows-snapshot:"), ci.indexOf("\n  checks:"))
    expect(job).toContain("node script/rebuild-node-pty.mjs")
    expect(job).not.toContain("rebuild node-pty-prebuilt-multiarch")
  })
})

function writePackage(gypPath: string, version: string) {
  mkdirSync(dirname(gypPath), { recursive: true })
  writeFileSync(gypPath, "")
  writeFileSync(join(gypPath, "..", "..", "package.json"), JSON.stringify({ version }))
}
