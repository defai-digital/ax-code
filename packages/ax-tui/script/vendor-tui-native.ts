/** Offline verification of the native libraries built from this repository. */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { NATIVE_TARGETS, type BuildTarget } from "./native-targets.js"
import { nativeSourceDigest } from "./native-source.js"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const VENDOR_DIR = join(ROOT, "vendor")
const MANIFEST_PATH = join(VENDOR_DIR, "manifest.json")
export const sha256 = (buf: Uint8Array): string => createHash("sha256").update(buf).digest("hex")

export interface NativeBuildEntry {
  os: BuildTarget["os"]
  cpu: BuildTarget["cpu"]
  libc?: "musl"
  build: { sourceSha256: string; zigVersion: string; target: string; optimize: "ReleaseFast" }
  lib: { file: string; size: number; sha256: string }
  licenseSha256: string
}

export interface NativeBuildManifest {
  schemaVersion: 2
  origin: { repository: string; version: string; commit: string; license: string }
  builtAt: string
  targets: Record<string, NativeBuildEntry>
}

/** Validate magic bytes and machine architecture of the extracted library. */
export function assertBinaryFormat(buf: Buffer, target: Pick<BuildTarget, "os" | "cpu" | "key">) {
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
    if (machine !== want)
      throw new Error(`${target.key}: ELF machine ${machine.toString(16)} != expected ${want.toString(16)}`)
    return
  }
  // win32: MZ header, PE machine at peOffset + 4
  if (buf.readUInt16BE(0) !== 0x4d5a) throw new Error(`${target.key}: not a PE (missing MZ)`)
  const pe = buf.readUInt32LE(0x3c)
  if (buf.readUInt32BE(pe) !== 0x50450000) throw new Error(`${target.key}: missing PE\\0\\0 signature`)
  const machine = buf.readUInt16LE(pe + 4)
  const want = target.cpu === "arm64" ? 0xaa64 : 0x8664
  if (machine !== want)
    throw new Error(`${target.key}: PE machine ${machine.toString(16)} != expected ${want.toString(16)}`)
}

export function checkVendorTree(vendorDir = VENDOR_DIR, manifestPath = MANIFEST_PATH): string[] {
  const problems: string[] = []
  if (!existsSync(manifestPath)) return [`manifest missing: ${manifestPath}`]
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as NativeBuildManifest
  if (manifest.schemaVersion !== 2) problems.push("native manifest must record local source build provenance")
  const sourceSha256 = nativeSourceDigest()
  const zigVersion = readFileSync(join(ROOT, ".zig-version"), "utf8").trim()
  for (const target of NATIVE_TARGETS) {
    const entry = manifest.targets?.[target.key]
    const dir = join(vendorDir, target.key)
    if (existsSync(dir)) {
      for (const file of readdirSync(dir)) {
        if (file !== target.libFile && file !== "LICENSE") problems.push(`${target.key}: unexpected artifact ${file}`)
      }
    }
    if (!entry) {
      problems.push(`${target.key}: missing from manifest`)
      continue
    }
    if (entry.build?.sourceSha256 !== sourceSha256) problems.push(`${target.key}: native source has changed; rebuild`)
    if (
      entry.build?.zigVersion !== zigVersion ||
      entry.build?.target !== target.zig ||
      entry.build?.optimize !== "ReleaseFast"
    ) {
      problems.push(`${target.key}: build configuration does not match the pinned toolchain and target`)
    }
    if (entry.os !== target.os || entry.cpu !== target.cpu || entry.libc !== target.libc) {
      problems.push(`${target.key}: platform metadata mismatch`)
    }
    if (entry.lib?.file !== target.libFile) {
      problems.push(`${target.key}: invalid library filename`)
      continue
    }
    const libPath = join(dir, target.libFile)
    if (!existsSync(libPath)) {
      problems.push(`${target.key}: missing ${target.libFile}`)
      continue
    }
    const buf = readFileSync(libPath)
    if (buf.byteLength !== entry.lib.size)
      problems.push(`${target.key}: size ${buf.byteLength} != manifest ${entry.lib.size}`)
    if (sha256(buf) !== entry.lib.sha256) problems.push(`${target.key}: library SHA-256 drift`)
    const licensePath = join(dir, "LICENSE")
    if (!existsSync(licensePath)) problems.push(`${target.key}: missing LICENSE`)
    else if (sha256(readFileSync(licensePath)) !== entry.licenseSha256) problems.push(`${target.key}: LICENSE drift`)
    try {
      assertBinaryFormat(buf, target)
    } catch {
      problems.push(`${target.key}: binary format validation failed`)
    }
  }
  const expected = new Set<string>([...NATIVE_TARGETS.map((t) => t.key), "manifest.json"])
  if (existsSync(vendorDir)) {
    for (const entry of readdirSync(vendorDir)) {
      if (!expected.has(entry)) problems.push(`unexpected entry in vendor/: ${entry}`)
    }
  }
  for (const target of Object.keys(manifest.targets ?? {})) {
    if (!NATIVE_TARGETS.some((entry) => entry.key === target)) problems.push(`unexpected target in manifest: ${target}`)
  }
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--check") throw new Error("Use pnpm run build:native --all to build from local source")
  const problems = checkVendorTree()
  if (problems.length) throw new Error(`Native verification failed:\n${problems.join("\n")}`)
  console.log(`Native libraries match local source and manifest (${NATIVE_TARGETS.length} targets)`)
}
