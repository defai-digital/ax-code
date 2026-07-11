import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { HfCache } from "../../../src/provider/ax-engine/hf-cache"
import {
  downloadModel,
  getDiskStatus,
  getModelStatus,
  markPrepared,
  reclaimManagedCopy,
  reclaimManagedModelCopies,
} from "../../../src/provider/ax-engine/model-cache"
import { AxEnginePaths } from "../../../src/provider/ax-engine/paths"
import { Filesystem } from "../../../src/util/filesystem"
import { Process } from "../../../src/util/process"

const GEMMA = { modelID: "gemma-4-12b", quant: "mlx6bit", repo: "mlx-community/gemma-4-12B-it-6bit" } as const
const GLM = { modelID: "glm-4.7-flash", quant: "mlx6bit", repo: "mlx-community/GLM-4.7-Flash-6bit" } as const
const CODER = {
  modelID: "qwen3-coder-next-6bit",
  quant: "mlx6bit",
  repo: "mlx-community/Qwen3-Coder-Next-6bit",
} as const
const COMMIT = "1111111111111111111111111111111111111111"
const FALLBACK_COMMIT = "2222222222222222222222222222222222222222"

async function makeHfSnapshot(
  hfRoot: string,
  repo: string,
  commit: string,
  opts: { manifest?: boolean; packageMarker?: boolean } = {},
) {
  const base = path.join(hfRoot, `models--${repo.replace(/\//g, "--")}`)
  const snapshot = path.join(base, "snapshots", commit)
  await fs.mkdir(snapshot, { recursive: true })
  await fs.mkdir(path.join(base, "refs"), { recursive: true })
  await fs.writeFile(path.join(base, "refs", "main"), commit)
  await fs.writeFile(path.join(snapshot, "model-00001-of-00001.safetensors"), "weights")
  await fs.writeFile(path.join(snapshot, "config.json"), "{}")
  if (opts.manifest !== false) await fs.writeFile(path.join(snapshot, "model-manifest.json"), "{}")
  if (opts.packageMarker !== false) await fs.writeFile(path.join(snapshot, "ax_gemma4_assistant_mtp.json"), "{}")
  return snapshot
}

describe("HfCache.root precedence", () => {
  const home = "/home/test"
  test("prefers HF_HUB_CACHE, then HF_HOME/hub, then XDG, then ~/.cache", () => {
    expect(HfCache.root({ HF_HUB_CACHE: "/explicit/hub" }, home)).toBe("/explicit/hub")
    expect(HfCache.root({ HF_HOME: "/hf/home" }, home)).toBe(path.join("/hf/home", "hub"))
    expect(HfCache.root({ XDG_CACHE_HOME: "/xdg/cache" }, home)).toBe(path.join("/xdg/cache", "huggingface", "hub"))
    expect(HfCache.root({}, home)).toBe(path.join(home, ".cache", "huggingface", "hub"))
  })

  test("repoDir encodes the org/name the Hugging Face way", () => {
    expect(HfCache.repoDir("mlx-community/Qwen3.6-27B-6bit", { HF_HUB_CACHE: "/hub" }, home)).toBe(
      "/hub/models--mlx-community--Qwen3.6-27B-6bit",
    )
  })

  test("isInside detects cache membership", () => {
    const env = { HF_HUB_CACHE: "/hub" }
    expect(HfCache.isInside("/hub/models--x/snapshots/abc", env, home)).toBe(true)
    expect(HfCache.isInside("/hub/..models--x/snapshots/abc", env, home)).toBe(true)
    expect(HfCache.isInside("/elsewhere/models", env, home)).toBe(false)
  })
})

describe("HfCache.snapshotDir / isCompleteSnapshot", () => {
  test("prefers the refs/main commit and requires weights + manifest", async () => {
    await using dir = await tmpdir()
    const hfRoot = path.join(dir.path, "hub")
    const snapshot = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT)
    const env = { HF_HUB_CACHE: hfRoot }

    expect(await HfCache.snapshotDir(GEMMA.repo, env)).toBe(snapshot)
    expect(await HfCache.isCompleteSnapshot(snapshot)).toBe(true)
  })

  test("an incomplete snapshot (no AX manifest) is not usable", async () => {
    await using dir = await tmpdir()
    const hfRoot = path.join(dir.path, "hub")
    const snapshot = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT, { manifest: false })
    expect(await HfCache.isCompleteSnapshot(snapshot)).toBe(false)
  })

  test("completeSnapshotDir falls back when refs/main points at an incomplete snapshot", async () => {
    await using dir = await tmpdir()
    const hfRoot = path.join(dir.path, "hub")
    const pinned = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT, { manifest: false })
    const fallback = await makeHfSnapshot(hfRoot, GEMMA.repo, FALLBACK_COMMIT)
    await fs.writeFile(path.join(hfRoot, `models--${GEMMA.repo.replace(/\//g, "--")}`, "refs", "main"), COMMIT)

    expect(await HfCache.snapshotDir(GEMMA.repo, { HF_HUB_CACHE: hfRoot })).toBe(pinned)
    expect(await HfCache.completeSnapshotDir(GEMMA.repo, { HF_HUB_CACHE: hfRoot })).toBe(fallback)
  })

  test("returns undefined when the repo is not cached", async () => {
    await using dir = await tmpdir()
    expect(await HfCache.snapshotDir(GEMMA.repo, { HF_HUB_CACHE: path.join(dir.path, "hub") })).toBeUndefined()
    expect(await HfCache.completeSnapshotDir(GEMMA.repo, { HF_HUB_CACHE: path.join(dir.path, "hub") })).toBeUndefined()
  })

  test("rejects a snapshot with a dangling weight symlink", async () => {
    await using dir = await tmpdir()
    const hfRoot = path.join(dir.path, "hub")
    const snapshot = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT)
    // Simulate an interrupted download: the snapshot link exists but the blob
    // it points at was never written.
    await fs.rm(path.join(snapshot, "model-00001-of-00001.safetensors"))
    await fs.symlink(
      path.join("..", "..", "blobs", "never-downloaded"),
      path.join(snapshot, "model-00001-of-00001.safetensors"),
    )
    expect(await HfCache.isCompleteSnapshot(snapshot)).toBe(false)
  })

  test("rejects a snapshot missing shards named by the weight index", async () => {
    await using dir = await tmpdir()
    const hfRoot = path.join(dir.path, "hub")
    const snapshot = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT)
    await fs.writeFile(
      path.join(snapshot, "model.safetensors.index.json"),
      JSON.stringify({
        weight_map: {
          "a.weight": "model-00001-of-00002.safetensors",
          "b.weight": "model-00002-of-00002.safetensors",
        },
      }),
    )
    await fs.writeFile(path.join(snapshot, "model-00001-of-00002.safetensors"), "shard1")
    expect(await HfCache.isCompleteSnapshot(snapshot)).toBe(false)

    await fs.writeFile(path.join(snapshot, "model-00002-of-00002.safetensors"), "shard2")
    expect(await HfCache.isCompleteSnapshot(snapshot)).toBe(true)
  })
})

describe("ax-engine model storage uses the HF snapshot", () => {
  let prevHf: string | undefined
  let hfRoot: string

  beforeEach(async () => {
    prevHf = process.env.HF_HUB_CACHE
    // Isolate both stores: the HF cache in a tmp dir, the legacy managed dir in
    // the test home (AX_CODE_TEST_HOME already points AxEnginePaths there).
    await fs.rm(AxEnginePaths.models, { recursive: true, force: true })
    await fs.rm(AxEnginePaths.prepareState, { force: true }).catch(() => undefined)
  })

  afterEach(async () => {
    if (prevHf === undefined) delete process.env.HF_HUB_CACHE
    else process.env.HF_HUB_CACHE = prevHf
    await fs.rm(AxEnginePaths.models, { recursive: true, force: true })
    await fs.rm(AxEnginePaths.prepareState, { force: true }).catch(() => undefined)
  })

  test("getModelStatus resolves the HF snapshot over a legacy managed copy", async () => {
    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    const snapshot = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT)
    // Legacy managed copy also complete — HF must still win.
    const managed = AxEnginePaths.managedModelDir(GEMMA.modelID, GEMMA.quant)
    await fs.mkdir(managed, { recursive: true })
    await fs.writeFile(path.join(managed, "model-manifest.json"), "{}")

    const status = await getModelStatus({ modelID: GEMMA.modelID, quantization: GEMMA.quant })
    expect(status.present).toBe(true)
    expect(status.path).toBe(snapshot)
  })

  test("getModelStatus does not treat an HF snapshot without weights as complete", async () => {
    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    const snapshot = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT)
    await fs.rm(path.join(snapshot, "model-00001-of-00001.safetensors"))

    const status = await getModelStatus({ modelID: GEMMA.modelID, quantization: GEMMA.quant })
    expect(status.present).toBe(false)
    expect(status.blockers).toEqual([
      "AX_ENGINE_MODEL_MISSING: prepare Gemma 4 12B 6-bit (Local MLX MTP) before using ax-engine",
    ])
  })

  test("getModelStatus rejects base weights without the required MTP package", async () => {
    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT, { packageMarker: false })

    const status = await getModelStatus({ modelID: GEMMA.modelID, quantization: GEMMA.quant })
    expect(status.present).toBe(false)
    expect(status.blockers).toEqual([
      "AX_ENGINE_MODEL_MISSING: prepare Gemma 4 12B 6-bit (Local MLX MTP) before using ax-engine",
    ])
  })

  test("getModelStatus does not let prepared HF state bypass snapshot completeness checks", async () => {
    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    const snapshot = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT)
    await fs.rm(path.join(snapshot, "model-00001-of-00001.safetensors"))
    await Filesystem.writeJson(AxEnginePaths.prepareState, {
      modelID: GEMMA.modelID,
      quantization: GEMMA.quant,
      path: snapshot,
      preparedAt: 1,
    })

    const status = await getModelStatus({ modelID: GEMMA.modelID, quantization: GEMMA.quant })
    expect(status.present).toBe(false)
  })

  test("markPrepared rejects incomplete HF snapshots before reporting them complete", async () => {
    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    const snapshot = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT)
    await fs.rm(path.join(snapshot, "model-00001-of-00001.safetensors"))

    await expect(
      markPrepared({ modelID: GEMMA.modelID, quantization: GEMMA.quant, modelPath: snapshot }),
    ).rejects.toThrow("model path is incomplete")
    const status = await getModelStatus({ modelID: GEMMA.modelID, quantization: GEMMA.quant })
    expect(status.present).toBe(false)
  })

  test("downloadModel rejects incomplete HF snapshots returned by ax-engine", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    const snapshot = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT)
    await fs.rm(path.join(snapshot, "model-00001-of-00001.safetensors"))
    const originalText = Process.text
    vi.spyOn(Process, "text").mockImplementation((cmd, opts) => {
      if (cmd[0] === "df") {
        const stdout = Buffer.from(`Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/test 200000000 1000000 120000000 1% ${cmd.at(-1) ?? "/"}
`)
        return Promise.resolve({ code: 0, stdout, stderr: Buffer.alloc(0), text: stdout.toString() })
      }
      return originalText(cmd, opts)
    })
    const binary = path.join(dir.path, "fake-ax-engine")
    await fs.writeFile(
      binary,
      `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({ dest: snapshot, revision: COMMIT }))})\n`,
    )
    await fs.chmod(binary, 0o755)

    await expect(
      downloadModel({ binaryPath: binary, modelID: GEMMA.modelID, quantization: GEMMA.quant }),
    ).rejects.toThrow("downloaded model path is incomplete")
    expect(await Filesystem.exists(AxEnginePaths.prepareState)).toBe(false)
  })

  test("downloadModel checks disk space against the requested model, not the default", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    const snapshot = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT)
    const originalText = Process.text
    // 60 GiB free: enough for gemma-4-12b (48 GiB) but not for the default
    // model's 96 GiB requirement, which a call site that drops modelID would
    // apply to every download.
    const availableBlocks = (60 * 1024 ** 3) / 1024
    const spy = vi.spyOn(Process, "text").mockImplementation((cmd, opts) => {
      if (cmd[0] === "df") {
        const stdout = Buffer.from(`Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/test 200000000 1000000 ${availableBlocks} 1% ${cmd.at(-1) ?? "/"}
`)
        return Promise.resolve({ code: 0, stdout, stderr: Buffer.alloc(0), text: stdout.toString() })
      }
      return originalText(cmd, opts)
    })
    try {
      const binary = path.join(dir.path, "fake-ax-engine")
      await fs.writeFile(
        binary,
        `#!/usr/bin/env node\nconsole.log(${JSON.stringify(
          JSON.stringify({ output_dir: snapshot, download: { revision: COMMIT } }),
        )})\n`,
      )
      await fs.chmod(binary, 0o755)

      const prepared = await downloadModel({ binaryPath: binary, modelID: GEMMA.modelID, quantization: GEMMA.quant })
      expect(prepared.path).toBe(snapshot)
      expect(
        spy.mock.calls.some(
          ([cmd]) =>
            Array.isArray(cmd) &&
            cmd[0] === binary &&
            cmd[1] === "download-mtp" &&
            cmd[2] === GEMMA.modelID &&
            cmd[3] === "--json",
        ),
      ).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  test("downloadModel prepares GLM through its built-in MTP package path", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    const snapshot = await makeHfSnapshot(hfRoot, GLM.repo, COMMIT)
    await fs.writeFile(path.join(snapshot, "ax_glm_mtp_manifest.json"), "{}")
    const availableBlocks = (120 * 1024 ** 3) / 1024
    const originalText = Process.text
    const spy = vi.spyOn(Process, "text").mockImplementation((cmd, opts) => {
      if (cmd[0] === "df") {
        const stdout = Buffer.from(`Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/test 200000000 1000000 ${availableBlocks} 1% ${cmd.at(-1) ?? "/"}
`)
        return Promise.resolve({ code: 0, stdout, stderr: Buffer.alloc(0), text: stdout.toString() })
      }
      return originalText(cmd, opts)
    })
    try {
      const binary = path.join(dir.path, "fake-ax-engine")
      await fs.writeFile(
        binary,
        `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({ dest: snapshot, revision: COMMIT }))})\n`,
      )
      await fs.chmod(binary, 0o755)

      await downloadModel({ binaryPath: binary, modelID: GLM.modelID, quantization: GLM.quant })
      expect(
        spy.mock.calls.some(
          ([cmd]) =>
            Array.isArray(cmd) &&
            cmd[0] === binary &&
            cmd[1] === "download-mtp" &&
            cmd[2] === GLM.modelID &&
            cmd[3] === "--json",
        ),
      ).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  test("downloadModel keeps Qwen3-Coder-Next on the direct download path", async () => {
    if (process.platform === "win32") return

    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    const snapshot = await makeHfSnapshot(hfRoot, CODER.repo, COMMIT)
    const availableBlocks = (120 * 1024 ** 3) / 1024
    const originalText = Process.text
    const spy = vi.spyOn(Process, "text").mockImplementation((cmd, opts) => {
      if (cmd[0] === "df") {
        const stdout = Buffer.from(`Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/test 200000000 1000000 ${availableBlocks} 1% ${cmd.at(-1) ?? "/"}
`)
        return Promise.resolve({ code: 0, stdout, stderr: Buffer.alloc(0), text: stdout.toString() })
      }
      return originalText(cmd, opts)
    })
    try {
      const binary = path.join(dir.path, "fake-ax-engine")
      await fs.writeFile(
        binary,
        `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({ dest: snapshot, revision: COMMIT }))})\n`,
      )
      await fs.chmod(binary, 0o755)

      await downloadModel({ binaryPath: binary, modelID: CODER.modelID, quantization: CODER.quant })
      expect(
        spy.mock.calls.some(
          ([cmd]) =>
            Array.isArray(cmd) &&
            cmd[0] === binary &&
            cmd[1] === "download" &&
            cmd[2] === CODER.repo &&
            cmd[3] === "--json",
        ),
      ).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  test("getDiskStatus returns a blocker for a dangling cache symlink instead of throwing", async () => {
    if (process.platform === "win32") return
    await using dir = await tmpdir()
    const target = path.join(dir.path, "missing-volume", "huggingface")
    const link = path.join(dir.path, "huggingface")
    await fs.symlink(target, link)

    const status = await getDiskStatus({
      modelID: GEMMA.modelID,
      quantization: GEMMA.quant,
      downloadDir: link,
    })
    expect(status.ok).toBe(false)
    expect(status.freeBytes).toBeUndefined()
    expect(status.blockers.join(" ")).toContain("could not determine free disk space")
  })

  test("getModelStatus falls back to another complete HF snapshot when refs/main is incomplete", async () => {
    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT, { manifest: false })
    const fallback = await makeHfSnapshot(hfRoot, GEMMA.repo, FALLBACK_COMMIT)
    await fs.writeFile(path.join(hfRoot, `models--${GEMMA.repo.replace(/\//g, "--")}`, "refs", "main"), COMMIT)

    const status = await getModelStatus({ modelID: GEMMA.modelID, quantization: GEMMA.quant })
    expect(status.present).toBe(true)
    expect(status.path).toBe(fallback)
  })

  test("reclaimManagedCopy deletes the managed copy once the HF snapshot is verified", async () => {
    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    const snapshot = await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT)
    const managed = AxEnginePaths.managedModelDir(GEMMA.modelID, GEMMA.quant)
    await fs.mkdir(managed, { recursive: true })
    await fs.writeFile(path.join(managed, "model.safetensors"), "weights")
    // prepare.json still points at the managed dir — must be repointed.
    await Filesystem.writeJson(AxEnginePaths.prepareState, {
      modelID: GEMMA.modelID,
      quantization: GEMMA.quant,
      path: managed,
      preparedAt: 1,
    })

    const result = await reclaimManagedCopy(GEMMA.modelID, GEMMA.quant)
    expect(result?.snapshotPath).toBe(snapshot)
    expect(await Filesystem.exists(managed)).toBe(false)
    const state = await Filesystem.readJson(AxEnginePaths.prepareState)
    expect((state as { path: string }).path).toBe(snapshot)
  })

  test("reclaimManagedCopy refuses to delete the only copy (HF snapshot incomplete)", async () => {
    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT, { manifest: false }) // no AX manifest -> not safe
    const managed = AxEnginePaths.managedModelDir(GEMMA.modelID, GEMMA.quant)
    await fs.mkdir(managed, { recursive: true })
    await fs.writeFile(path.join(managed, "model.safetensors"), "weights")

    const result = await reclaimManagedCopy(GEMMA.modelID, GEMMA.quant)
    expect(result).toBeUndefined()
    expect(await Filesystem.exists(managed)).toBe(true)
  })

  test("reclaimManagedCopy keeps an MTP-ready copy when the HF snapshot lacks its sidecar package", async () => {
    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT, { packageMarker: false })
    const managed = AxEnginePaths.managedModelDir(GEMMA.modelID, GEMMA.quant)
    await fs.mkdir(managed, { recursive: true })
    await fs.writeFile(path.join(managed, "model.safetensors"), "weights")
    await fs.writeFile(path.join(managed, "ax_gemma4_assistant_mtp.json"), "{}")

    const result = await reclaimManagedCopy(GEMMA.modelID, GEMMA.quant)
    expect(result).toBeUndefined()
    expect(await Filesystem.exists(managed)).toBe(true)
  })

  test("reclaimManagedCopy refuses to delete when prepare state cannot be inspected", async () => {
    await using dir = await tmpdir()
    hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    await makeHfSnapshot(hfRoot, GEMMA.repo, COMMIT)
    const managed = AxEnginePaths.managedModelDir(GEMMA.modelID, GEMMA.quant)
    await fs.mkdir(managed, { recursive: true })
    await fs.writeFile(path.join(managed, "model.safetensors"), "weights")
    await fs.mkdir(path.dirname(AxEnginePaths.prepareState), { recursive: true })
    await fs.writeFile(AxEnginePaths.prepareState, "{not json")

    const result = await reclaimManagedCopy(GEMMA.modelID, GEMMA.quant)
    expect(result).toBeUndefined()
    expect(await Filesystem.exists(managed)).toBe(true)
  })

  test("reclaimManagedModelCopies is a no-op when there is no managed dir", async () => {
    await using dir = await tmpdir()
    process.env.HF_HUB_CACHE = path.join(dir.path, "hub")
    expect(await reclaimManagedModelCopies()).toEqual([])
  })
})
