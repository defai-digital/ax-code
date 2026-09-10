import { afterEach, describe, expect, test } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { verifyPty } = require("./verify-pty.cjs") as {
  verifyPty: (modulePath: string, options?: { timeoutMs: number }) => Promise<{ verified: boolean }>
}
const temporary: string[] = []
afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function fixture(mode: "success" | "echo" | "crash" | "load-only") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-code-pty-probe-"))
  temporary.push(dir)
  fs.writeFileSync(
    path.join(dir, "index.cjs"),
    [
      "const mode = " + JSON.stringify(mode) + ";",
      "exports.spawn = () => {",
      "if (mode === 'load-only') throw new Error('ConPTY addon missing');",
      "let data, exit;",
      "return {",
      "onData(fn) { data = fn; setImmediate(() => data('AX_CODE_PTY_READY')); return { dispose() {} }; },",
      "onExit(fn) { exit = fn; return { dispose() {} }; },",
      "resize() {}, kill() {},",
      "write(input) { setImmediate(() => {",
      "data(mode === 'echo' ? input : 'AX_CODE_PTY_RESULT_' + [...input.trim()].reverse().join(''));",
      "exit({ exitCode: mode === 'crash' ? 1 : 0 });",
      "}); } }; };",
    ].join("\n"),
  )
  return path.join(dir, "index.cjs")
}

describe("PTY release admission", () => {
  test("requires computed output and a successful exit", async () => {
    await expect(verifyPty(fixture("success"))).resolves.toMatchObject({ verified: true })
  })
  test("does not accept terminal echo as a roundtrip", async () => {
    await expect(verifyPty(fixture("echo"), { timeoutMs: 100 })).rejects.toThrow("timed out")
  })
  test("rejects a failed exit even after receiving correct output", async () => {
    await expect(verifyPty(fixture("crash"))).rejects.toThrow("code=1")
  })
  test("rejects lazy native loading failures", async () => {
    await expect(verifyPty(fixture("load-only"))).rejects.toThrow("ConPTY addon missing")
  })
})

describe("Windows PTY build configuration", () => {
  const coreRequire = createRequire(path.resolve("packages/ax-code/package.json"))
  const installed = path.dirname(coreRequire.resolve("node-pty-prebuilt-multiarch/package.json"))
  const source = fs.readFileSync(path.join(installed, "scripts/install.js"), "utf8")
  function invocation(platform: string) {
    const calls: Array<{ command: string; args: string[]; options: { env: Record<string, string> } }> = []
    vm.runInNewContext(source, {
      __dirname: path.join(installed, "scripts"),
      process: { env: { GYP_DEFINES: "custom_flag=1", CXXFLAGS: "-flto=thin" }, exit() {} },
      require(name: string) {
        if (name === "os") return { platform: () => platform }
        if (name === "path") return path
        if (name === "child_process") {
          return {
            spawn(command: string, args: string[], options: { env: Record<string, string> }) {
              calls.push({ command, args, options })
              return { on() {} }
            },
          }
        }
        throw new Error("Unexpected module: " + name)
      },
    })
    expect(calls).toHaveLength(1)
    return calls[0]!
  }
  test("overrides inherited Node LTO variables through node-gyp options", () => {
    const call = invocation("win32")
    expect(call.command).toBe("node-gyp.cmd")
    expect(call.args).toEqual(expect.arrayContaining(["--enable-lto=false", "--enable-thin-lto=false", "--lto-jobs=0"]))
    expect(call.options.env.CXXFLAGS).toBeUndefined()
    expect(call.options.env.GYP_DEFINES).toContain("custom_flag=1")
  })
  test("preserves Unix configuration", () => {
    const call = invocation("darwin")
    expect(call.command).toBe("node-gyp")
    expect(call.args).toEqual(["rebuild"])
    expect(call.options.env.CXXFLAGS).toBe("-flto=thin")
  })
})
