import fs from "fs/promises"
import path from "path"
import { afterEach, expect, test, vi } from "vitest"
import {
  AxEngineMtpLaunchError,
  assertAxEngineMtpPackCompatibility,
  axEngineSupportsPrefixedMtpSidecar,
  readAxEngineMtpSidecarNamespace,
} from "../../../src/provider/ax-engine/mtp"
import { ensureServer } from "../../../src/provider/ax-engine/server"
import { FileLock } from "../../../src/util/filelock"
import { tmpdir } from "../../fixture/fixture"

// Pins the tracing literal the engine compiles into builds carrying the
// sidecar namespace normalization (ax-engine weights.rs).
const NORMALIZATION_MARKER = "MTP sidecar namespace normalization"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function sidecarBytes(keys: readonly string[]) {
  const header = JSON.stringify(
    Object.fromEntries(keys.map((key) => [key, { dtype: "BF16", shape: [1], data_offsets: [0, 2] }])),
  )
  const prefix = Buffer.alloc(8)
  prefix.writeBigUInt64LE(BigInt(Buffer.byteLength(header)), 0)
  return Buffer.concat([prefix, Buffer.from(header, "utf8"), Buffer.alloc(2)])
}

async function writePack(dir: string, keys?: readonly string[]) {
  if (keys) await fs.writeFile(path.join(dir, "mtp.safetensors"), sidecarBytes(keys))
  return dir
}

async function writeEngine(dir: string, opts: { marker: boolean; server?: boolean }) {
  await fs.mkdir(dir, { recursive: true })
  const launcher = path.join(dir, "ax-engine")
  await fs.writeFile(launcher, "launcher")
  if (opts.server !== false) {
    await fs.writeFile(
      path.join(dir, "ax-engine-server"),
      opts.marker ? `trace: ${NORMALIZATION_MARKER} produced a duplicate tensor` : "engine without the normalization",
    )
  }
  return launcher
}

test("sidecar namespace probe reads bare, prefixed, and unreadable packs", async () => {
  await using bare = await tmpdir({
    init: (dir) =>
      writePack(dir, ["mtp.fc.weight", "mtp.norm.weight", "language_model.model.layers.0.mlp.gate.weight"]),
  })
  await using prefixed = await tmpdir({
    init: (dir) => writePack(dir, ["language_model.mtp.fc.weight", "language_model.mtp.norm.weight"]),
  })
  await using missing = await tmpdir({ init: (dir) => writePack(dir) })
  await using malformed = await tmpdir({
    init: (dir) => fs.writeFile(path.join(dir, "mtp.safetensors"), Buffer.from([1, 2, 3])),
  })
  expect(await readAxEngineMtpSidecarNamespace(bare.path)).toBe("bare")
  expect(await readAxEngineMtpSidecarNamespace(prefixed.path)).toBe("prefixed")
  expect(await readAxEngineMtpSidecarNamespace(missing.path)).toBe("unknown")
  expect(await readAxEngineMtpSidecarNamespace(malformed.path)).toBe("unknown")
})

test("binary capability probe detects the normalization marker through symlinks", async () => {
  await using tmp = await tmpdir()
  const supported = await writeEngine(path.join(tmp.path, "supported"), { marker: true })
  const unsupported = await writeEngine(path.join(tmp.path, "unsupported"), { marker: false })
  const noServer = await writeEngine(path.join(tmp.path, "no-server"), { marker: false, server: false })
  const linkDir = path.join(tmp.path, "link")
  await fs.mkdir(linkDir)
  const linked = path.join(linkDir, "ax-engine")
  await fs.symlink(supported, linked)
  expect(await axEngineSupportsPrefixedMtpSidecar(supported)).toBe(true)
  expect(await axEngineSupportsPrefixedMtpSidecar(unsupported)).toBe(false)
  expect(await axEngineSupportsPrefixedMtpSidecar(noServer)).toBe(undefined)
  expect(await axEngineSupportsPrefixedMtpSidecar(linked)).toBe(true)
})

test("required policy over a prefixed sidecar fails fast with the actionable version error", async () => {
  await using pack = await tmpdir({ init: (dir) => writePack(dir, ["language_model.mtp.fc.weight"]) })
  await using engine = await tmpdir({ init: (dir) => writeEngine(dir, { marker: false }) })
  const binaryPath = path.join(engine.path, "ax-engine")
  const error = await assertAxEngineMtpPackCompatibility({
    modelPath: pack.path,
    binaryPath,
    policy: "required",
    binaryVersion: "7.4.0",
  }).catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(AxEngineMtpLaunchError)
  const message = (error as Error).message
  expect(message).toMatch(new RegExp(`^AX_ENGINE_VERSION_UNSUPPORTED:.*${binaryPath}`, "s"))
  // The pairing cannot change between prompt-loop turns; a retryable
  // classification would replay the whole doomed engine setup three times.
  expect((error as { isRetryable?: unknown }).isRetryable).toBe(false)
})

test.each(["auto", "disabled"] as const)("%s policy never blocks on the pack namespace", async (policy) => {
  await using pack = await tmpdir({ init: (dir) => writePack(dir, ["language_model.mtp.fc.weight"]) })
  await using engine = await tmpdir({ init: (dir) => writeEngine(dir, { marker: false }) })
  await assertAxEngineMtpPackCompatibility({
    modelPath: pack.path,
    binaryPath: path.join(engine.path, "ax-engine"),
    policy,
    binaryVersion: "7.4.0",
  })
})

test.each([
  { name: "bare sidecar", keys: ["mtp.fc.weight"], marker: false },
  { name: "missing sidecar", keys: undefined, marker: false },
  { name: "unprobeable binary", keys: ["language_model.mtp.fc.weight"], marker: false, server: false },
  { name: "normalizing binary", keys: ["language_model.mtp.fc.weight"], marker: true },
] as const)("$name does not block a required launch", async ({ keys, marker, server }) => {
  await using pack = await tmpdir({ init: (dir) => writePack(dir, keys) })
  await using engine = await tmpdir({ init: (dir) => writeEngine(dir, { marker, server }) })
  await assertAxEngineMtpPackCompatibility({
    modelPath: pack.path,
    binaryPath: path.join(engine.path, "ax-engine"),
    policy: "required",
    binaryVersion: "7.4.0",
  })
})

test("incompatible pack/binary pairing is rejected before the lifecycle lock or a spawn", async () => {
  await using pack = await tmpdir({ init: (dir) => writePack(dir, ["language_model.mtp.fc.weight"]) })
  await using engine = await tmpdir({ init: (dir) => writeEngine(dir, { marker: false }) })
  const lock = vi.spyOn(FileLock, "acquire")
  await expect(
    ensureServer({
      binaryPath: path.join(engine.path, "ax-engine"),
      modelID: "tiel-coder-35b-axq-mxfp4",
      apiModelID: "tiel-coder-35b-axq-mxfp4",
      modelPath: pack.path,
      binaryVersion: "7.4.0",
      mtpPolicy: "required",
    }),
  ).rejects.toThrow("AX_ENGINE_VERSION_UNSUPPORTED")
  expect(lock).not.toHaveBeenCalled()
})

test("compatible pairing passes the gate and reaches the lifecycle lock", async () => {
  await using pack = await tmpdir({ init: (dir) => writePack(dir, ["language_model.mtp.fc.weight"]) })
  await using engine = await tmpdir({ init: (dir) => writeEngine(dir, { marker: true }) })
  const lock = vi.spyOn(FileLock, "acquire").mockRejectedValue(new Error("sentinel: gate passed"))
  await expect(
    ensureServer({
      binaryPath: path.join(engine.path, "ax-engine"),
      modelID: "tiel-coder-35b-axq-mxfp4",
      apiModelID: "tiel-coder-35b-axq-mxfp4",
      modelPath: pack.path,
      binaryVersion: "7.4.0",
      mtpPolicy: "required",
    }),
  ).rejects.toThrow("sentinel: gate passed")
  expect(lock).toHaveBeenCalled()
})
