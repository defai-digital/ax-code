import fs from "fs/promises"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { AX_ENGINE_ERROR } from "./constants"
import type { AxEngineModelID, AxEngineQuantization } from "./constants"
import { AxEnginePaths } from "./paths"
import { HfCache } from "./hf-cache"
import { clearPreparedStateForPath, getModelStatus } from "./model-cache"
import { getServerStatus } from "./server"

export type AxEngineDeleteModelResponse = {
  deleted: boolean
  modelID: AxEngineModelID
  quantization: AxEngineQuantization
  path?: string
  freedBytes?: number
  preparedStateUpdated: boolean
}

// Size of the regular files under a directory. Symlinks are deliberately not
// followed: for HF-cache layouts the blobs are counted once where they live,
// not once per snapshot link pointing at them.
async function directorySize(dir: string): Promise<number | undefined> {
  let total = 0
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const p = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(p)
      else if (entry.isFile()) total += (await fs.stat(p)).size
    }
  }
  try {
    await walk(dir)
    return total
  } catch {
    return undefined
  }
}

// Real paths of every symlink target inside an HF snapshot (the blobs the
// snapshot's weight/config links point at).
async function snapshotBlobTargets(snapshot: string): Promise<Set<string>> {
  const targets = new Set<string>()
  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const p = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(p)
      else if (entry.isSymbolicLink()) {
        const real = await fs.realpath(p).catch(() => undefined)
        if (real) targets.add(real)
      }
    }
  }
  await walk(snapshot)
  return targets
}

async function totalFileSize(paths: Iterable<string>): Promise<number> {
  let total = 0
  for (const p of paths) {
    const stat = await fs.stat(p).catch(() => undefined)
    if (stat?.isFile()) total += stat.size
  }
  return total
}

// Delete an HF-cache snapshot including the blobs it references. The snapshot
// itself is only symlinks — removing it alone frees almost nothing, and the
// tens of GB stay stranded in blobs/. When this is the repo's sole snapshot
// the whole repo dir goes (blobs, refs, metadata); otherwise only the blobs no
// remaining snapshot references are removed, and refs pointing at the deleted
// commit are pruned.
async function deleteHfSnapshot(target: string): Promise<number | undefined> {
  const snapshotsDir = path.dirname(target)
  const repoRoot = path.dirname(snapshotsDir)
  const commit = path.basename(target)

  const siblings = (await fs.readdir(snapshotsDir, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && entry.name !== commit)
    .map((entry) => path.join(snapshotsDir, entry.name))

  if (siblings.length === 0) {
    const freedBytes = await directorySize(repoRoot)
    await fs.rm(repoRoot, { recursive: true, force: true })
    return freedBytes
  }

  const mine = await snapshotBlobTargets(target)
  const kept = new Set<string>()
  for (const sibling of siblings) {
    for (const blob of await snapshotBlobTargets(sibling)) kept.add(blob)
  }
  const exclusiveBlobs = [...mine].filter((blob) => !kept.has(blob) && Filesystem.contains(repoRoot, blob))

  // Freed = the snapshot's own regular files plus the blobs only it referenced
  // (shared blobs survive for the remaining snapshots and must not count).
  const freedBytes = ((await directorySize(target)) ?? 0) + (await totalFileSize(exclusiveBlobs))
  await fs.rm(target, { recursive: true, force: true })
  await Promise.all(exclusiveBlobs.map((blob) => fs.rm(blob, { force: true }).catch(() => undefined)))

  // Prune refs (e.g. refs/main) that pinned the deleted commit so resolution
  // does not keep pointing at a snapshot that no longer exists.
  const refsDir = path.join(repoRoot, "refs")
  const refs = await fs.readdir(refsDir, { withFileTypes: true }).catch(() => [])
  for (const ref of refs) {
    if (!ref.isFile()) continue
    const refPath = path.join(refsDir, ref.name)
    const pinned = await fs
      .readFile(refPath, "utf8")
      .then((s) => s.trim())
      .catch(() => undefined)
    if (pinned === commit) await fs.rm(refPath, { force: true }).catch(() => undefined)
  }

  return freedBytes
}

function isEligibleDeleteTarget(target: string) {
  const resolved = path.resolve(target)
  if (Filesystem.contains(AxEnginePaths.models, resolved)) return true
  if (!HfCache.isInside(resolved)) return false
  return resolved.split(path.sep).includes("snapshots")
}

export async function deleteAxEngineModel(input: {
  modelID: AxEngineModelID
  quantization: AxEngineQuantization
}): Promise<AxEngineDeleteModelResponse> {
  const status = await getModelStatus({ modelID: input.modelID, quantization: input.quantization })
  if (!status.present || !status.path) {
    return {
      deleted: false,
      modelID: input.modelID,
      quantization: input.quantization,
      preparedStateUpdated: false,
    }
  }

  const target = path.resolve(status.path)
  if (!isEligibleDeleteTarget(target)) {
    throw new Error(`${AX_ENGINE_ERROR.ModelNotPrepared}: resolved model path is not managed by AX Code`)
  }

  const server = await getServerStatus()
  if (
    server.state?.modelPath &&
    (server.state.modelPath === target || Filesystem.contains(target, server.state.modelPath))
  ) {
    throw new Error(`${AX_ENGINE_ERROR.ServerStartFailed}: stop AX Engine before deleting the active model`)
  }

  const preparedStateUpdated = await clearPreparedStateForPath(target)

  let freedBytes: number | undefined
  if (HfCache.isInside(target)) {
    freedBytes = await deleteHfSnapshot(target)
  } else {
    freedBytes = status.bytes ?? (await directorySize(target))
    await fs.rm(target, { recursive: true, force: true })
    await fs.rmdir(path.dirname(target)).catch(() => undefined)
  }

  return {
    deleted: true,
    modelID: input.modelID,
    quantization: input.quantization,
    path: target,
    freedBytes,
    preparedStateUpdated,
  }
}
