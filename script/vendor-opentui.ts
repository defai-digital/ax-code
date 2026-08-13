#!/usr/bin/env -S npx tsx
/**
 * Vendor the upstream OpenTUI native (Zig) shared libraries into
 * packages/opentui-core/vendor/<target>/ so the TUI renderer no longer
 * depends on the @opentui/core-<platform> npm packages at install or
 * runtime.
 *
 * Usage:
 *   tsx script/vendor-opentui.ts           # fetch, verify, extract, write manifest
 *   tsx script/vendor-opentui.ts --check   # offline: committed tree must match manifest
 *
 * Trust model: --update verifies each tarball against the registry-provided
 * SRI (sha512) integrity value, validates the extracted package (name,
 * version, os/cpu/libc, binary magic + machine architecture), and records
 * per-file sha256 hashes in vendor/manifest.json. --check is fully offline
 * and fails on any drift between the manifest and the committed files.
 */

import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const VENDOR_DIR = join(ROOT, "packages", "opentui-core", "vendor")
const MANIFEST_PATH = join(VENDOR_DIR, "manifest.json")

/** Upstream OpenTUI native package version. Bump here, then re-run --update. */
const VERSION = "0.4.1"
const UPSTREAM_REPOSITORY = "https://github.com/sst/opentui"
const UPSTREAM_LICENSE = "MIT"

interface Target {
  /** canonical vendor directory name, e.g. "linux-x64-musl" */
  key: string
  /** upstream npm package name */
  pkg: string
  os: "darwin" | "linux" | "win32"
  cpu: "x64" | "arm64"
  libc?: "musl"
  /** expected shared library filename inside the tarball */
  libFile: string
}

const TARGETS: Target[] = [
  { key: "darwin-x64", pkg: "@opentui/core-darwin-x64", os: "darwin", cpu: "x64", libFile: "libopentui.dylib" },
  { key: "darwin-arm64", pkg: "@opentui/core-darwin-arm64", os: "darwin", cpu: "arm64", libFile: "libopentui.dylib" },
  { key: "linux-x64", pkg: "@opentui/core-linux-x64", os: "linux", cpu: "x64", libFile: "libopentui.so" },
  { key: "linux-arm64", pkg: "@opentui/core-linux-arm64", os: "linux", cpu: "arm64", libFile: "libopentui.so" },
  { key: "linux-x64-musl", pkg: "@opentui/core-linux-x64-musl", os: "linux", cpu: "x64", libc: "musl", libFile: "libopentui.so" },
  { key: "linux-arm64-musl", pkg: "@opentui/core-linux-arm64-musl", os: "linux", cpu: "arm64", libc: "musl", libFile: "libopentui.so" },
  { key: "win32-x64", pkg: "@opentui/core-win32-x64", os: "win32", cpu: "x64", libFile: "opentui.dll" },
  { key: "win32-arm64", pkg: "@opentui/core-win32-arm64", os: "win32", cpu: "arm64", libFile: "opentui.dll" },
]

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex")
const sha512Sri = (buf: Buffer) => `sha512-${createHash("sha512").update(buf).digest("base64")}`

function fail(msg: string): never {
  console.error(`vendor-opentui: ${msg}`)
  process.exit(1)
}

/** Validate magic bytes and machine architecture of the extracted library. */
export function assertBinaryFormat(buf: Buffer, target: Pick<Target, "os" | "cpu" | "key">) {
  const want64le = (off: number) => buf.readUInt32LE(off)
  if (target.os === "darwin") {
    const magic = buf.readUInt32BE(0)
    // MH_MAGIC_64 / MH_CIGAM_64 / FAT_MAGIC / FAT_MAGIC_64 (+ CIGAM variants)
    const magics = [0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]
    if (!magics.includes(magic)) throw new Error(`${target.key}: not a Mach-O (magic ${magic.toString(16)})`)
    if (magic === 0xfeedfacf || magic === 0xcffaedfe) {
      const cputype = magic === 0xfeedfacf ? buf.readUInt32BE(4) : want64le(4)
      const want = target.cpu === "arm64" ? 0x0100000c : 0x01000007
      if (cputype !== want)
        throw new Error(`${target.key}: Mach-O cputype ${cputype.toString(16)} != expected ${want.toString(16)}`)
    }
    return
  }
  if (target.os === "linux") {
    if (buf.readUInt32BE(0) !== 0x7f454c46) throw new Error(`${target.key}: not an ELF`)
    const machine = buf.readUInt16LE(18)
    const want = target.cpu === "arm64" ? 0xb7 : 0x3e
    if (machine !== want) throw new Error(`${target.key}: ELF machine ${machine.toString(16)} != expected ${want.toString(16)}`)
    return
  }
  // win32: MZ header, PE machine at peOffset + 4
  if (buf.readUInt16BE(0) !== 0x4d5a) throw new Error(`${target.key}: not a PE (missing MZ)`)
  const pe = buf.readUInt32LE(0x3c)
  if (buf.readUInt32BE(pe) !== 0x50450000) throw new Error(`${target.key}: missing PE\\0\\0 signature`)
  const machine = buf.readUInt16LE(pe + 4)
  const want = target.cpu === "arm64" ? 0xaa64 : 0x8664
  if (machine !== want) throw new Error(`${target.key}: PE machine ${machine.toString(16)} != expected ${want.toString(16)}`)
}

function npmView(pkg: string): { tarball: string; integrity: string } {
  const res = spawnSync("npm", ["view", `${pkg}@${VERSION}`, "dist.tarball", "dist.integrity", "--json"], {
    encoding: "utf8",
  })
  if (res.status !== 0) fail(`npm view failed for ${pkg}: ${res.stderr?.trim()}`)
  const parsed = JSON.parse(res.stdout)
  // Queried as dotted fields, npm returns flat keys: { "dist.tarball": ..., "dist.integrity": ... }
  const meta = { tarball: parsed["dist.tarball"], integrity: parsed["dist.integrity"] }
  if (!meta.tarball || !meta.integrity) fail(`registry metadata incomplete for ${pkg}@${VERSION}`)
  return meta as { tarball: string; integrity: string }
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) fail(`download failed: ${url} (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

/** List tarball entries as "type path" lines; rejects links and traversal. */
function listTarball(tgz: string): string[] {
  const res = spawnSync("tar", ["-tvzf", tgz], { encoding: "utf8" })
  if (res.status !== 0) fail(`tar listing failed: ${res.stderr?.trim()}`)
  return res.stdout.trim().split("\n")
}

function extractFiles(tgz: string, dest: string, files: string[]) {
  const res = spawnSync("tar", ["-xzf", tgz, "-C", dest, ...files], { encoding: "utf8" })
  if (res.status !== 0) fail(`tar extract failed: ${res.stderr?.trim()}`)
}

async function updateTarget(target: Target): Promise<Record<string, unknown>> {
  const meta = npmView(target.pkg)
  const tarball = await download(meta.tarball)
  const actualSri = sha512Sri(tarball)
  if (actualSri !== meta.integrity) {
    fail(`${target.key}: tarball integrity mismatch\n  registry: ${meta.integrity}\n  actual:   ${actualSri}`)
  }

  const tmp = mkdtempSync(join(tmpdir(), "opentui-vendor-"))
  try {
    const tgz = join(tmp, "pkg.tgz")
    writeFileSync(tgz, tarball)

    const entries = listTarball(tgz)
    const wanted = new Set([`package/${target.libFile}`, "package/LICENSE", "package/package.json"])
    const seen = new Set<string>()
    for (const line of entries) {
      // bsdtar/GNU tar verbose: first column is mode string (e.g. -rw-r--r--, l..., h...)
      const type = line[0]
      const name = line.split(/\s+/).pop()
      if (!name) fail(`${target.key}: unparseable tar listing line: ${line}`)
      if (type === "l" || type === "h") fail(`${target.key}: tarball contains a link entry: ${name}`)
      if (name.includes("..") || name.startsWith("/")) fail(`${target.key}: unsafe tarball path: ${name}`)
      if (seen.has(name)) fail(`${target.key}: duplicate tarball entry: ${name}`)
      seen.add(name)
    }
    for (const w of wanted) if (!seen.has(w)) fail(`${target.key}: tarball is missing ${w}`)

    extractFiles(tgz, tmp, [...wanted])

    const pkgJson = JSON.parse(readFileSync(join(tmp, "package", "package.json"), "utf8"))
    if (pkgJson.name !== target.pkg || pkgJson.version !== VERSION) {
      fail(`${target.key}: package.json identity mismatch (${pkgJson.name}@${pkgJson.version})`)
    }
    const osOk = Array.isArray(pkgJson.os) ? pkgJson.os.includes(target.os) : true
    const cpuOk = Array.isArray(pkgJson.cpu) ? pkgJson.cpu.includes(target.cpu) : true
    if (!osOk || !cpuOk) fail(`${target.key}: package.json os/cpu mismatch: ${JSON.stringify({ os: pkgJson.os, cpu: pkgJson.cpu })}`)
    if (target.libc === "musl" && pkgJson.libc !== "musl" && !(Array.isArray(pkgJson.libc) && pkgJson.libc.includes("musl"))) {
      fail(`${target.key}: expected musl package, package.json libc=${JSON.stringify(pkgJson.libc)}`)
    }

    const lib = readFileSync(join(tmp, "package", target.libFile))
    try {
      assertBinaryFormat(lib, target)
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
    const licenseBuf = readFileSync(join(tmp, "package", "LICENSE"))

    // Atomic publish: stage beside the target dir, then rename over it.
    const stageDir = mkdtempSync(join(VENDOR_DIR, ".stage-"))
    const stageTarget = join(stageDir, target.key)
    mkdirSync(stageTarget, { recursive: true })
    writeFileSync(join(stageTarget, target.libFile), lib)
    writeFileSync(join(stageTarget, "LICENSE"), licenseBuf)
    rmSync(join(VENDOR_DIR, target.key), { recursive: true, force: true })
    renameSync(stageTarget, join(VENDOR_DIR, target.key))
    rmSync(stageDir, { recursive: true, force: true })

    return {
      package: target.pkg,
      os: target.os,
      cpu: target.cpu,
      ...(target.libc ? { libc: target.libc } : {}),
      tarball: meta.tarball,
      tarballIntegrity: meta.integrity,
      lib: { file: target.libFile, size: lib.byteLength, sha256: sha256(lib) },
      licenseSha256: sha256(licenseBuf),
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

interface Manifest {
  upstream: { version: string; repository: string; license: string }
  retrievedAt: string
  targets: Record<string, { lib: { file: string; size: number; sha256: string }; licenseSha256: string }>
}

export function checkVendorTree(vendorDir = VENDOR_DIR, manifestPath = MANIFEST_PATH): string[] {
  const problems: string[] = []
  if (!existsSync(manifestPath)) return [`manifest missing: ${manifestPath}`]
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest
  if (manifest.upstream?.version !== VERSION) {
    problems.push(`manifest version ${manifest.upstream?.version} != script VERSION ${VERSION}`)
  }
  for (const target of TARGETS) {
    const entry = manifest.targets?.[target.key]
    const dir = join(vendorDir, target.key)
    if (!entry) {
      problems.push(`${target.key}: missing from manifest`)
      continue
    }
    const libPath = join(dir, entry.lib.file)
    if (!existsSync(libPath)) {
      problems.push(`${target.key}: missing ${entry.lib.file}`)
      continue
    }
    const buf = readFileSync(libPath)
    if (buf.byteLength !== entry.lib.size) problems.push(`${target.key}: size ${buf.byteLength} != manifest ${entry.lib.size}`)
    const hash = sha256(buf)
    if (hash !== entry.lib.sha256) problems.push(`${target.key}: sha256 drift (${hash.slice(0, 12)}… != ${entry.lib.sha256.slice(0, 12)}…)`)
    const licensePath = join(dir, "LICENSE")
    if (!existsSync(licensePath)) problems.push(`${target.key}: missing LICENSE`)
    else if (sha256(readFileSync(licensePath)) !== entry.licenseSha256) problems.push(`${target.key}: LICENSE drift`)
    try {
      assertBinaryFormat(buf, target)
    } catch {
      problems.push(`${target.key}: binary format validation failed`)
    }
  }
  const expected = new Set([...TARGETS.map((t) => t.key), "manifest.json"])
  if (existsSync(vendorDir)) {
    for (const entry of readdirSync(vendorDir)) {
      if (!expected.has(entry) && !entry.startsWith(".stage-")) problems.push(`unexpected entry in vendor/: ${entry}`)
    }
  }
  return problems
}

async function main() {
  const check = process.argv.includes("--check")
  if (check) {
    const problems = checkVendorTree()
    if (problems.length > 0) {
      for (const p of problems) console.error(`  ✗ ${p}`)
      fail(`vendor tree drifted from manifest (${problems.length} problem(s)); run pnpm vendor:opentui-native`)
    }
    console.log(`✓ vendored OpenTUI native libraries match manifest (${TARGETS.length} targets, v${VERSION})`)
    return
  }

  mkdirSync(VENDOR_DIR, { recursive: true })
  const targets: Record<string, unknown> = {}
  for (const target of TARGETS) {
    console.log(`→ ${target.pkg}@${VERSION}`)
    targets[target.key] = await updateTarget(target)
  }
  const manifest = {
    upstream: { version: VERSION, repository: UPSTREAM_REPOSITORY, license: UPSTREAM_LICENSE },
    retrievedAt: new Date().toISOString(),
    targets: Object.fromEntries(Object.entries(targets).sort(([a], [b]) => a.localeCompare(b))),
  }
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n")
  console.log(`\nWrote ${MANIFEST_PATH}`)
  const problems = checkVendorTree()
  if (problems.length > 0) fail(`post-update check failed:\n  ${problems.join("\n  ")}`)
  console.log("✓ post-update verification passed")
}

// Allow tests to import helpers without running the CLI.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
