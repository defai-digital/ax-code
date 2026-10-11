import { afterEach, describe, expect, test, vi } from "vitest"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { DebugEngine } from "@ax-code/ax-code-reason"
import { codeReasonHost } from "@ax-code/ax-code-reason/host"
import { NativeAddon } from "../../src/native/addon"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(() => vi.restoreAllMocks())
const binding = NativeAddon.fs()
const available = !!binding?.detectFilesAsync && !!binding.ScanCancellation

const corpus: Record<string, string> = {
  "src/security.ts": [
    "const target = path.join(root, userInput)",
    "",
    "exec(`tool ${input}`)",
    "",
    "spawn(command + arg)",
    "",
    "const options = { env: {...process.env} }",
    "",
    "app.post('/write', handler)",
    "",
    "fetch(remoteUrl)",
  ].join("\n"),
  "src/safe.ts": [
    "const scratch = path.join(os.tmpdir(), 'scratch')",
    "const literal = path.join('root', `safe`)",
    "const escaped = path.join('it\\'s', 'safe')",
    "const target = path.join(root, userInput); assertContained(target)",
    "fetch(remote); assertLoopbackHttpUrl(remote)",
    "app.post('/safe', validator(schema), handler)",
    "const options = { env: {...process.env} }; Env.sanitize()",
  ].join("\n"),
  "src/suppressed.ts":
    "// @scan-suppress security_scan\nexec(`tool ${input}`)\n// @scan-suppress lifecycle_scan\nfunction start(){setInterval(tick, 42)}",
  "src/resources.ts": [
    "function listeners() {",
    "  target.on('event', callback)",
    "  setInterval(tick, 42)",
    "  Bus.subscribe('event', callback)",
    "  const controller = new AbortController()",
    "  const child = spawn('tool')",
    "}",
    "function maps() { cache.set('a', 3); other.set('b', 4); cache.set('b', 5) }",
    "function clean() { const unsub = target.on('event', callback); unsubscribe(); clearTimeout(timer); controller.signal; child.kill() }",
    "for (const item of items) { map.set(item, 8) }",
  ].join("\n"),
  "src/hardcodes.ts": [
    "/* \u{1f600} */ call(42, -12, 123.4, 2026, array[3], 0, 2)",
    "const THRESHOLD: number = 5000",
    "const limit = 333; let local = 44",
    "fetch('https://example.test/api')",
    "fetch('http://localhost:1234')",
    "read('/Users/example/project'); read('C:\\example\\project')",
    "const URL = 'https://example.test'; const PATH = '/tmp/scratch'",
    "/* block start",
    "ignored = 555",
    "block end */ call(66)",
    "call(/* inline \u{1f600} */ 77) // ignored = 88",
    "const symbol = 'AI_UnsupportedModelVersionError'",
    "const protocol = 'textDocument/publishDiagnostics'",
    "const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'",
    "const shape = 'ExampleShape_7nD4pK9vR2xH8aQ5mL3sW6yT'",
    "call(-12.34suffix, word-55, -1, 123suffix)",
    "/* */ fetch('https://example.test/\u{1f600}')",
  ].join("\r\n"),
  "script/trusted.ts": "const target = path.join(root, userInput)",
  "drizzle.config.ts": "const target = path.join(root, userInput)",
  "src/\u03b1.ts": "\uFEFFconst limit = 42; fetch(url)\nfunction work(){setTimeout(task, 55)}",
  "src/ignored.test.ts": "exec(`bad ${input}`); fetch('https://example.test')",
}

describe.skipIf(!available)("source-built diagnostic workers", () => {
  test("all three projections match JS on a varied current-source corpus", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim()
    const all = execFileSync("git", ["ls-files", "packages/ax-code/src"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((file) => file.endsWith(".ts"))
      .sort()
    const files = all.filter((_, index) => index % Math.max(1, Math.floor(all.length / 32)) === 0).slice(0, 32)
    for (const relative of files) {
      const file = path.join(tmp.path, relative)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, await readFile(path.join(root, relative)))
    }
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const host = codeReasonHost()
        const flags = vi.spyOn(host, "flags")
        for (const method of ["detectSecurity", "detectLifecycle", "detectHardcodes"] as const) {
          const input = { files, maxFindingsPerFile: 200 }
          flags.mockReturnValue({ nativeScan: false })
          const expected = await DebugEngine[method](Instance.project.id, input)
          flags.mockReturnValue({ nativeScan: true })
          const actual = await DebugEngine[method](Instance.project.id, input)
          expect(actual.findings).toEqual(expected.findings)
          expect(actual.explain.heuristicsApplied).toContain("native-worker")
        }
      },
    })
  })

  for (const method of ["detectSecurity", "detectLifecycle", "detectHardcodes"] as const) {
    for (const scope of ["full", "incremental"] as const) {
      test(`${method} preserves JS findings and scope for ${scope} input`, async () => {
        await using tmp = await tmpdir({ git: true })
        for (const [relative, source] of Object.entries(corpus)) {
          const file = path.join(tmp.path, relative)
          await mkdir(path.dirname(file), { recursive: true })
          await writeFile(file, source)
        }
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const host = codeReasonHost()
            const worker = vi.fn(binding!.detectFilesAsync!)
            vi.spyOn(host.native!, "fs").mockReturnValue({ ...binding, detectFilesAsync: worker })
            const flags = vi.spyOn(host, "flags")
            const input = {
              excludeTests: true,
              maxFindingsPerFile: 200,
              ...(scope === "incremental" ? { files: Object.keys(corpus) } : {}),
            }
            flags.mockReturnValue({ nativeScan: false })
            const expected = await DebugEngine[method](Instance.project.id, input)
            flags.mockReturnValue({ nativeScan: true })
            const actual = await DebugEngine[method](Instance.project.id, input)
            expect(actual.findings).toEqual(expected.findings)
            expect(actual.filesScanned).toBe(expected.filesScanned)
            expect(actual.truncated).toBe(expected.truncated)
            expect(actual.auditCaveat).toBe(expected.auditCaveat)
            expect(JSON.stringify(actual.explain)).toContain("native-worker")
            expect(worker).toHaveBeenCalled()
          },
        })
      })
    }
  }

  test("empty selected scope never walks and cancellation never returns partial success", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const host = codeReasonHost()
        vi.spyOn(host, "flags").mockReturnValue({ nativeScan: true })
        const worker = vi.fn(binding!.detectFilesAsync!)
        vi.spyOn(host.native!, "fs").mockReturnValue({ ...binding, detectFilesAsync: worker })
        const report = await DebugEngine.detectSecurity(Instance.project.id, { files: [] })
        expect(report.findings).toEqual([])
        expect(report.filesScanned).toBe(0)
        expect(worker).not.toHaveBeenCalled()
        const signal = AbortSignal.abort()
        await expect(DebugEngine.detectSecurity(Instance.project.id, { files: [], signal })).rejects.toMatchObject({
          name: "AbortError",
        })
        const cancelled = new binding!.ScanCancellation()
        cancelled.cancel()
        await expect(
          binding!.detectFilesAsync!(
            JSON.stringify({ kind: "security", files: [], patterns: [], maxPerFile: 20 }),
            cancelled,
          ),
        ).rejects.toThrow("cancelled")
      },
    })
  })

  test("unreadable native input retries the whole selected scope with JS rules", async () => {
    await using tmp = await tmpdir({ git: true })
    await mkdir(path.join(tmp.path, "src"))
    await writeFile(path.join(tmp.path, "src", "a.ts"), "const limit = 42; fetch(url)\n")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const flags = vi.spyOn(codeReasonHost(), "flags")
        const input = { files: ["src/a.ts", "src/missing.ts"] }
        flags.mockReturnValue({ nativeScan: false })
        const expected = await DebugEngine.detectSecurity(Instance.project.id, input)
        flags.mockReturnValue({ nativeScan: true })
        const actual = await DebugEngine.detectSecurity(Instance.project.id, input)
        expect(actual.findings).toEqual(expected.findings)
        expect(actual.filesScanned).toBe(expected.filesScanned)
        expect(actual.explain.heuristicsApplied).not.toContain("native-worker")
      },
    })
  })

  test("malformed worker output falls back to JS without synchronous native retries", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "app.ts")
    await writeFile(file, "exec(`tool ${input}`)")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const host = codeReasonHost()
        vi.spyOn(host, "flags").mockReturnValue({ nativeScan: true })
        const readFilesBatch = vi.fn(() => {
          throw new Error("No sync fallback")
        })
        vi.spyOn(host.native!, "fs").mockReturnValue({
          ...binding,
          readFilesBatch,
          detectFilesAsync: async () => "invalid-json",
        })
        const report = await DebugEngine.detectSecurity(Instance.project.id, { files: [file] })
        expect(report.findings).toHaveLength(1)
        expect(report.findings[0].pattern).toBe("command_injection")
        expect(readFilesBatch).not.toHaveBeenCalled()
      },
    })
  })
})
