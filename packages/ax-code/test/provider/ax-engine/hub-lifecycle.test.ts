import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { tmpdir } from "../../fixture/fixture"
import { HfCache } from "../../../src/provider/ax-engine/hf-cache"
import { AxEnginePaths } from "../../../src/provider/ax-engine/paths"
import { downloadModel, getModelStatus, markPrepared } from "../../../src/provider/ax-engine/model-cache"
import { deleteAxEngineModel } from "../../../src/provider/ax-engine/delete"
import { Filesystem } from "../../../src/util/filesystem"
import { Process } from "../../../src/util/process"
import { HubCatalog, hubModelID } from "../../../src/provider/ax-engine/hub-model"
import snapshot from "../../../src/provider/ax-engine/hub-catalog-snapshot.json"

const model = HubCatalog.parse(snapshot).models.find(
  (entry) => entry.id === "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-4bit-MTP",
)!
const id = hubModelID(model)
const other = "f".repeat(40)

async function makeSnapshot(revision: string) {
  const root = HfCache.repoDir(model.id)
  const dir = path.join(root, "snapshots", revision)
  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(path.join(root, "refs"), { recursive: true })
  await fs.writeFile(path.join(root, "refs", "main"), revision)
  for (const file of model.siblings.filter(
    (entry) =>
      entry.rfilename.endsWith(".safetensors") ||
      ["config.json", "tokenizer.json", "tokenizer_config.json"].includes(entry.rfilename),
  )) {
    await fs.writeFile(path.join(dir, file.rfilename), "fixture artifact")
  }
  await Filesystem.writeJson(path.join(dir, "model-manifest.json"), {})
  return dir
}

describe("pinned Hub artifact lifecycle", () => {
  let previousHf: string | undefined
  beforeEach(async () => {
    previousHf = process.env.HF_HUB_CACHE
    await fs.rm(AxEnginePaths.prepareState, { force: true })
    await fs.rm(AxEnginePaths.serverState, { force: true })
  })
  afterEach(async () => {
    if (previousHf === undefined) delete process.env.HF_HUB_CACHE
    else process.env.HF_HUB_CACHE = previousHf
    vi.restoreAllMocks()
    await fs.rm(AxEnginePaths.prepareState, { force: true })
  })

  test("finds the requested revision even when refs/main points to a newer snapshot", async () => {
    await using tmp = await tmpdir()
    process.env.HF_HUB_CACHE = tmp.path
    const requested = await makeSnapshot(model.sha)
    await makeSnapshot(other)
    expect(await getModelStatus({ modelID: id, quantization: "mlx" })).toMatchObject({
      present: true,
      path: requested,
      revision: model.sha,
    })
    await fs.rm(requested, { recursive: true })
    expect((await getModelStatus({ modelID: id })).present).toBe(false)
    await expect(
      markPrepared({ modelID: id, modelPath: path.join(HfCache.repoDir(model.id), "snapshots", other) }),
    ).rejects.toThrow("does not match the pinned")
  })

  test("rejects a partial package whose native manifest references a missing sidecar", async () => {
    await using tmp = await tmpdir()
    process.env.HF_HUB_CACHE = tmp.path
    const requested = await makeSnapshot(model.sha)
    await fs.rm(path.join(requested, "vision.safetensors"))
    const status = await getModelStatus({ modelID: id })
    expect(status.present).toBe(false)
    expect(status.blockers.join(" ")).toContain("missing required file vision.safetensors")
    await expect(markPrepared({ modelID: id, modelPath: requested })).rejects.toThrow(
      "missing required file vision.safetensors",
    )
  })

  test("persists the pinned identity and deletes only that revision", async () => {
    await using tmp = await tmpdir()
    process.env.HF_HUB_CACHE = tmp.path
    const requested = await makeSnapshot(model.sha)
    const kept = await makeSnapshot(other)
    expect(await markPrepared({ modelID: id, modelPath: requested })).toMatchObject({
      modelID: id,
      quantization: "mlx",
      revision: model.sha,
    })
    expect(await deleteAxEngineModel({ modelID: id, quantization: "mlx" })).toMatchObject({
      deleted: true,
      path: requested,
      preparedStateUpdated: true,
    })
    expect(await Filesystem.exists(kept)).toBe(true)
    expect(await Filesystem.exists(requested)).toBe(false)
  })

  test.each(["match", "wrong", "missing"])(
    "downloads with a pinned argument and handles %s revision evidence",
    async (evidence) => {
      if (process.platform === "win32") return
      await using tmp = await tmpdir()
      process.env.HF_HUB_CACHE = path.join(tmp.path, "hub")
      const destination = await makeSnapshot(evidence === "missing" ? other : model.sha)
      const argsPath = path.join(tmp.path, "args.json")
      const binaryPath = path.join(tmp.path, "fake-engine")
      const result = {
        dest: destination,
        ...(evidence === "missing" ? {} : { revision: evidence === "wrong" ? other : model.sha }),
      }
      await fs.writeFile(
        binaryPath,
        `#!/usr/bin/env node\nrequire("fs").writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)))\nconsole.log(${JSON.stringify(JSON.stringify(result))})\n`,
      )
      await fs.chmod(binaryPath, 0o755)
      const original = Process.text
      vi.spyOn(Process, "text").mockImplementation((cmd, options) => {
        if (cmd[0] !== "df") return original(cmd, options)
        const text = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/test 900000000 1 800000000 1% /\n"
        return Promise.resolve({ code: 0, stdout: Buffer.from(text), stderr: Buffer.alloc(0), text })
      })
      const action = downloadModel({ modelID: id, binaryPath, binaryVersion: "7.2.1" })
      if (evidence === "match")
        expect(await action).toMatchObject({ modelID: id, revision: model.sha, path: destination })
      else await expect(action).rejects.toThrow("revision does not match")
      expect(await Filesystem.readJson(argsPath)).toEqual(["download", id, "--json", "--progress-json"])
      if (evidence !== "match") expect(await Filesystem.exists(AxEnginePaths.prepareState)).toBe(false)
    },
  )

  test("rejects a matching revision reported from an unexpected destination", async () => {
    if (process.platform === "win32") return
    await using tmp = await tmpdir()
    process.env.HF_HUB_CACHE = path.join(tmp.path, "hub")
    const destination = path.join(tmp.path, "outside")
    await fs.mkdir(destination, { recursive: true })
    for (const file of model.siblings.filter(
      (entry) =>
        entry.rfilename.endsWith(".safetensors") ||
        ["config.json", "tokenizer.json", "tokenizer_config.json"].includes(entry.rfilename),
    )) {
      await fs.writeFile(path.join(destination, file.rfilename), "fixture artifact")
    }
    await Filesystem.writeJson(path.join(destination, "model-manifest.json"), {})
    const binaryPath = path.join(tmp.path, "fake-engine")
    await fs.writeFile(
      binaryPath,
      `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({ dest: destination, revision: model.sha }))})\n`,
    )
    await fs.chmod(binaryPath, 0o755)
    const original = Process.text
    vi.spyOn(Process, "text").mockImplementation((cmd, options) => {
      if (cmd[0] !== "df") return original(cmd, options)
      const text = "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/test 900000000 1 800000000 1% /\n"
      return Promise.resolve({ code: 0, stdout: Buffer.from(text), stderr: Buffer.alloc(0), text })
    })

    await expect(downloadModel({ modelID: id, binaryPath, binaryVersion: "7.2.1" })).rejects.toThrow(
      "revision does not match",
    )
    expect(await Filesystem.exists(AxEnginePaths.prepareState)).toBe(false)
  })

  test("does not fall back to another revision for incomplete-snapshot deletion", async () => {
    await using tmp = await tmpdir()
    process.env.HF_HUB_CACHE = tmp.path
    const kept = await makeSnapshot(other)
    expect(await deleteAxEngineModel({ modelID: id, quantization: "mlx" })).toMatchObject({ deleted: false })
    expect(await Filesystem.exists(kept)).toBe(true)
  })
})
