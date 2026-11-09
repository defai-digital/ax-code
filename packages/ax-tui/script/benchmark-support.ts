import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { cpus, release } from "node:os"
import { dirname, join, resolve } from "node:path"
import { tuiRoot } from "./build-text-width-experiment.js"
import { nativeSourceDigest } from "./native-source.js"

export function distribution(values: readonly number[]) {
  assert.ok(values.length > 0 && values.every((value) => Number.isFinite(value) && value >= 0), "Invalid measurements")
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return {
    count: sorted.length,
    min: sorted[0],
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1)!,
  }
}

export function benchmarkOptions(
  args: string[],
  defaults: { output: string; iterations: number; warmup: number },
  kind: "application" | "kernel" = "application",
) {
  const options = { ...defaults, samples: 7, child: false, profile: false, backend: "native", directory: "" }
  const seen = new Set<string>()
  for (const arg of args) {
    if (arg === "--child") {
      assert.ok(!options.child, "Duplicate --child")
      options.child = true
      continue
    }
    if (arg === "--profile") {
      assert.ok(!options.profile, "Duplicate --profile")
      options.profile = true
      continue
    }
    const match = /^--(output|samples|iterations|warmup|backend|directory)=(.+)$/.exec(arg)
    assert.ok(match, `Unknown benchmark argument: ${arg}`)
    const [, name, value] = match
    if (name === "backend" || name === "directory")
      assert.equal(kind, "kernel", `Unsupported --${name} for application benchmark`)
    assert.ok(!seen.has(name), `Duplicate --${name}`)
    seen.add(name)
    if (name === "samples" || name === "iterations" || name === "warmup") {
      assert.match(value, /^\d+$/, `Invalid --${name}`)
      const count = Number(value)
      assert.ok(
        Number.isSafeInteger(count) &&
          count >= (name === "warmup" ? 0 : 1) &&
          count <= (name === "samples" ? 31 : 10000),
        `Invalid --${name}`,
      )
      options[name] = count
    } else if (name === "backend") {
      assert.ok(value === "native" || value === "wasm", "Invalid --backend")
      options.backend = value
    } else options[name as "directory" | "output"] = resolve(value)
  }
  return options
}

export function benchmarkProvenance(harnessFiles: string[]) {
  const git = (args: string[]) => {
    const child = spawnSync("git", args, { cwd: tuiRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    assert.ifError(child.error)
    assert.equal(child.status, 0, child.stderr)
    return child.stdout
  }
  const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex")
  return {
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model,
    osRelease: release(),
    head: git(["rev-parse", "HEAD"]).trim(),
    trackedDiffSha256: hash(git(["diff", "--binary", "HEAD"])),
    nativeSourceSha256: nativeSourceDigest(),
    harnessSha256: Object.fromEntries(harnessFiles.map((file) => [file, hash(readFileSync(join(tuiRoot, file)))])),
    nativeManifestSha256: hash(readFileSync(join(tuiRoot, "vendor/manifest.json"))),
    rendererManifestSha256: hash(readFileSync(join(tuiRoot, "renderer-artifacts.json"))),
  }
}

export function benchmarkChild<T>(script: string, args: string[], ffi: boolean, profileDirectory?: string): T {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        !/^(?:AX_CODE_TUI_|OTUI_|OPENTUI_|TERM|COLORTERM|SSH_|TMUX|STY|NO_COLOR|FORCE_COLOR|NODE_OPTIONS)/.test(key),
    ),
  )
  Object.assign(env, { TERM: "xterm-256color", COLORTERM: "truecolor", AX_CODE_TUI_NATIVE_OFFLINE: "1" })
  if (profileDirectory) mkdirSync(profileDirectory, { recursive: true })
  const child = spawnSync(
    process.execPath,
    [
      ...(ffi ? ["--experimental-ffi"] : []),
      ...(profileDirectory ? ["--cpu-prof", `--cpu-prof-dir=${profileDirectory}`] : []),
      "--disable-warning=ExperimentalWarning",
      "--import",
      "tsx",
      script,
      "--child",
      ...args,
    ],
    { cwd: tuiRoot, env, encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
  )
  assert.ifError(child.error)
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`)
  return JSON.parse(child.stdout) as T
}

export function writeBenchmarkReport(file: string, report: unknown) {
  file = resolve(file)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n")
}
