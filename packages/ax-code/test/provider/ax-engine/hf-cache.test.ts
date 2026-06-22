import { afterEach, beforeEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { HfCache } from "../../../src/provider/ax-engine/hf-cache"
import {
  getModelStatus,
  reclaimManagedCopy,
  reclaimManagedModelCopies,
} from "../../../src/provider/ax-engine/model-cache"
import { AxEnginePaths } from "../../../src/provider/ax-engine/paths"
import { Filesystem } from "../../../src/util/filesystem"

const GEMMA = { modelID: "gemma-4-12b", quant: "mlx6bit", repo: "mlx-community/gemma-4-12B-it-6bit" } as const
const COMMIT = "1111111111111111111111111111111111111111"
const FALLBACK_COMMIT = "2222222222222222222222222222222222222222"

async function makeHfSnapshot(hfRoot: string, repo: string, commit: string, opts: { manifest?: boolean } = {}) {
  const base = path.join(hfRoot, `models--${repo.replace(/\//g, "--")}`)
  const snapshot = path.join(base, "snapshots", commit)
  await fs.mkdir(snapshot, { recursive: true })
  await fs.mkdir(path.join(base, "refs"), { recursive: true })
  await fs.writeFile(path.join(base, "refs", "main"), commit)
  await fs.writeFile(path.join(snapshot, "model-00001-of-00001.safetensors"), "weights")
  await fs.writeFile(path.join(snapshot, "config.json"), "{}")
  if (opts.manifest !== false) await fs.writeFile(path.join(snapshot, "model-manifest.json"), "{}")
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
    expect(HfCache.repoDir("mlx-community/Qwen3-Coder-Next-6bit", { HF_HUB_CACHE: "/hub" }, home)).toBe(
      "/hub/models--mlx-community--Qwen3-Coder-Next-6bit",
    )
  })

  test("isInside detects cache membership", () => {
    const env = { HF_HUB_CACHE: "/hub" }
    expect(HfCache.isInside("/hub/models--x/snapshots/abc", env, home)).toBe(true)
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
