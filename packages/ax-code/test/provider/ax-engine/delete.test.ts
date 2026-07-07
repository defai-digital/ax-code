import { afterEach, beforeEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import { deleteAxEngineModel } from "../../../src/provider/ax-engine/delete"
import { AxEnginePaths } from "../../../src/provider/ax-engine/paths"

const GEMMA = { modelID: "gemma-4-12b", quant: "mlx6bit", repo: "mlx-community/gemma-4-12B-it-6bit" } as const
const C1 = "1111111111111111111111111111111111111111"
const C2 = "2222222222222222222222222222222222222222"

function repoBase(hfRoot: string) {
  return path.join(hfRoot, `models--${GEMMA.repo.replace(/\//g, "--")}`)
}

async function writeBlob(hfRoot: string, hash: string, content: string) {
  const blobs = path.join(repoBase(hfRoot), "blobs")
  await fs.mkdir(blobs, { recursive: true })
  await fs.writeFile(path.join(blobs, hash), content)
  return path.join(blobs, hash)
}

// Real HF cache layout: the snapshot holds relative symlinks into blobs/, plus
// the regular metadata files the engine writes.
async function makeSnapshot(hfRoot: string, commit: string, links: Record<string, string>) {
  const base = repoBase(hfRoot)
  const snapshot = path.join(base, "snapshots", commit)
  await fs.mkdir(snapshot, { recursive: true })
  await fs.mkdir(path.join(base, "refs"), { recursive: true })
  for (const [name, hash] of Object.entries(links)) {
    await fs.symlink(path.join("..", "..", "blobs", hash), path.join(snapshot, name))
  }
  await fs.writeFile(path.join(snapshot, "model-manifest.json"), "{}")
  await fs.writeFile(path.join(snapshot, "config.json"), "{}")
  return snapshot
}

async function exists(target: string) {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false)
}

describe("deleteAxEngineModel frees HF cache blobs", () => {
  let prevHf: string | undefined

  beforeEach(async () => {
    prevHf = process.env.HF_HUB_CACHE
    await fs.rm(AxEnginePaths.models, { recursive: true, force: true })
    await fs.rm(AxEnginePaths.prepareState, { force: true }).catch(() => undefined)
  })

  afterEach(async () => {
    if (prevHf === undefined) delete process.env.HF_HUB_CACHE
    else process.env.HF_HUB_CACHE = prevHf
    await fs.rm(AxEnginePaths.models, { recursive: true, force: true })
    await fs.rm(AxEnginePaths.prepareState, { force: true }).catch(() => undefined)
  })

  test("sole snapshot: removes the whole repo dir including blobs", async () => {
    await using dir = await tmpdir()
    const hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    const weights = "W".repeat(4096)
    await writeBlob(hfRoot, "blob-a", weights)
    const snapshot = await makeSnapshot(hfRoot, C1, { "model-00001-of-00001.safetensors": "blob-a" })
    await fs.writeFile(path.join(repoBase(hfRoot), "refs", "main"), C1)

    const result = await deleteAxEngineModel({ modelID: GEMMA.modelID, quantization: GEMMA.quant })

    expect(result.deleted).toBe(true)
    expect(result.path).toBe(snapshot)
    // The snapshot is only symlinks — the real bytes live in blobs/ and must
    // be freed (and counted) too.
    expect(result.freedBytes ?? 0).toBeGreaterThanOrEqual(weights.length)
    expect(await exists(repoBase(hfRoot))).toBe(false)
  })

  test("shared blobs survive; exclusive blobs and stale refs are removed", async () => {
    await using dir = await tmpdir()
    const hfRoot = path.join(dir.path, "hub")
    process.env.HF_HUB_CACHE = hfRoot
    const shared = "S".repeat(4096)
    const exclusive = "X".repeat(8192)
    const sharedBlob = await writeBlob(hfRoot, "blob-shared", shared)
    const exclusiveBlob = await writeBlob(hfRoot, "blob-exclusive", exclusive)
    const keep = await makeSnapshot(hfRoot, C1, { "model-00001-of-00001.safetensors": "blob-shared" })
    const doomed = await makeSnapshot(hfRoot, C2, {
      "model-00001-of-00001.safetensors": "blob-shared",
      "extra.safetensors": "blob-exclusive",
    })
    await fs.writeFile(path.join(repoBase(hfRoot), "refs", "main"), C2)

    const result = await deleteAxEngineModel({ modelID: GEMMA.modelID, quantization: GEMMA.quant })

    expect(result.deleted).toBe(true)
    expect(result.path).toBe(doomed)
    expect(await exists(doomed)).toBe(false)
    expect(await exists(keep)).toBe(true)
    expect(await exists(sharedBlob)).toBe(true)
    expect(await exists(exclusiveBlob)).toBe(false)
    // refs/main pinned the deleted commit and must not keep pointing at it.
    expect(await exists(path.join(repoBase(hfRoot), "refs", "main"))).toBe(false)
    expect(result.freedBytes ?? 0).toBeGreaterThanOrEqual(exclusive.length)
    expect(result.freedBytes ?? 0).toBeLessThan(shared.length + exclusive.length)
  })

  test("managed (non-HF) model dirs still delete as before", async () => {
    await using dir = await tmpdir()
    process.env.HF_HUB_CACHE = path.join(dir.path, "hub")
    const managed = AxEnginePaths.managedModelDir(GEMMA.modelID, GEMMA.quant)
    await fs.mkdir(managed, { recursive: true })
    await fs.writeFile(path.join(managed, "model-manifest.json"), "{}")
    await fs.writeFile(path.join(managed, "model.safetensors"), "M".repeat(2048))

    const result = await deleteAxEngineModel({ modelID: GEMMA.modelID, quantization: GEMMA.quant })

    expect(result.deleted).toBe(true)
    expect(result.path).toBe(managed)
    expect(result.freedBytes ?? 0).toBeGreaterThanOrEqual(2048)
    expect(await exists(managed)).toBe(false)
  })
})
