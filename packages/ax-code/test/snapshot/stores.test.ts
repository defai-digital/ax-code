import { expect, test } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { SnapshotStores } from "../../src/snapshot/stores"
import { tmpdir } from "../fixture/fixture"

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()
const sha = (n: number) => n.toString(16).padStart(40, "0")

async function makeStore(
  root: string,
  id: string,
  input: {
    worktree?: string
    refs?: number
    idleDays?: number
    tmp?: { name: string; bytes: number; ageDays: number }[]
  },
) {
  const dir = path.join(root, id)
  await fs.mkdir(path.join(dir, "refs", "snapshots"), { recursive: true })
  await fs.mkdir(path.join(dir, "objects", "pack"), { recursive: true })
  await fs.mkdir(path.join(dir, "ax-code", "snapshots"), { recursive: true })
  await fs.writeFile(path.join(dir, "HEAD"), "ref: refs/heads/main\n")
  await fs.writeFile(
    path.join(dir, "config"),
    `[core]\n\tbare = false\n${input.worktree ? `\tworktree = ${input.worktree}\n` : ""}[safe]\n\tdirectory = /io\n`,
  )
  for (let i = 0; i < (input.refs ?? 0); i++) await fs.writeFile(path.join(dir, "refs", "snapshots", sha(i)), sha(i))
  await fs.writeFile(path.join(dir, "index"), "x".repeat(100))
  for (const file of input.tmp ?? []) {
    const target = path.join(dir, "objects", "pack", file.name)
    await fs.writeFile(target, Buffer.alloc(file.bytes))
    const when = new Date(now - file.ageDays * DAY)
    await fs.utimes(target, when, when)
  }
  const idle = new Date(now - (input.idleDays ?? 0) * DAY)
  for (const target of [
    path.join(dir, "index"),
    path.join(dir, "refs", "snapshots"),
    path.join(dir, "ax-code", "snapshots"),
  ])
    await fs.utimes(target, idle, idle)
  return dir
}

test("classifies stores by references, worktree and idle time", async () => {
  await using tmp = await tmpdir()
  const root = path.join(tmp.path, "snapshot")
  const live = path.join(tmp.path, "live")
  await fs.mkdir(live)
  await makeStore(root, sha(1), { worktree: live, refs: 2, idleDays: 0 })
  await makeStore(root, sha(2), { worktree: live, idleDays: 30 })
  await makeStore(root, sha(3), { worktree: path.join(tmp.path, "gone"), idleDays: 30 })
  await makeStore(root, sha(4), { worktree: path.join(tmp.path, "gone"), idleDays: 30 })
  await makeStore(root, sha(5), { worktree: path.join(tmp.path, "gone-recently"), idleDays: 0 })
  await makeStore(root, `dir-${sha(6)}`, { worktree: live, idleDays: 30 })
  await makeStore(root, sha(7), { worktree: live, idleDays: 30 })
  await fs.mkdir(path.join(root, "not-a-store"), { recursive: true })
  await fs.mkdir(path.join(root, sha(8)), { recursive: true }) // no HEAD
  const stores = await SnapshotStores.inspect({
    root,
    now,
    retained: (id) => (id === sha(4) ? new Set([sha(99)]) : id === sha(7) ? undefined : new Set()),
  })
  const state = Object.fromEntries(stores.map((store) => [store.id, store.state]))
  expect(state).toEqual({
    [sha(1)]: "active",
    [sha(2)]: "idle",
    [sha(3)]: "orphaned",
    [sha(4)]: "referenced",
    [sha(5)]: "active",
    [`dir-${sha(6)}`]: "idle",
    [sha(7)]: "unknown",
  })
  expect(stores.find((store) => store.id === sha(1))).toMatchObject({ refs: 2, worktreeExists: true })
})

test("prune removes only requested categories and never referenced or unknown stores", async () => {
  await using tmp = await tmpdir()
  const root = path.join(tmp.path, "snapshot")
  const live = path.join(tmp.path, "live")
  await fs.mkdir(live)
  const orphan = await makeStore(root, sha(1), { worktree: path.join(tmp.path, "gone"), idleDays: 30 })
  const idle = await makeStore(root, sha(2), { worktree: live, idleDays: 30 })
  const referenced = await makeStore(root, sha(3), { worktree: path.join(tmp.path, "gone"), idleDays: 30 })
  const unknown = await makeStore(root, sha(4), { worktree: path.join(tmp.path, "gone"), idleDays: 30 })
  const stores = await SnapshotStores.inspect({
    root,
    now,
    retained: (id) => (id === sha(3) ? new Set([sha(9)]) : id === sha(4) ? undefined : new Set()),
  })
  const exists = (dir: string) =>
    fs.stat(dir).then(
      () => true,
      () => false,
    )

  const preview = await SnapshotStores.prune({ root, stores, orphaned: true, idle: true, dryRun: true, now })
  expect(preview.removed.map((store) => store.id).sort()).toEqual([sha(1), sha(2)].sort())
  expect(await exists(orphan)).toBe(true)

  const onlyOrphaned = await SnapshotStores.prune({ root, stores, orphaned: true, idle: false, dryRun: false, now })
  expect(onlyOrphaned.removed.map((store) => store.id)).toEqual([sha(1)])
  expect(await exists(orphan)).toBe(false)
  expect(await exists(idle)).toBe(true)

  const rest = await SnapshotStores.prune({ root, stores, orphaned: true, idle: true, dryRun: false, now })
  expect(rest.removed.map((store) => store.id)).toContain(sha(2))
  expect(await exists(idle)).toBe(false)
  expect(await exists(referenced)).toBe(true)
  expect(await exists(unknown)).toBe(true)
})

test("prune with no category flags still clears stale pack temporaries and keeps fresh ones", async () => {
  await using tmp = await tmpdir()
  const root = path.join(tmp.path, "snapshot")
  const live = path.join(tmp.path, "live")
  await fs.mkdir(live)
  const dir = await makeStore(root, sha(1), {
    worktree: live,
    refs: 1,
    tmp: [
      { name: "tmp_pack_old", bytes: 4096, ageDays: 10 },
      { name: "tmp_pack_new", bytes: 2048, ageDays: 1 },
      { name: "pack-real.pack", bytes: 1024, ageDays: 40 },
    ],
  })
  const stores = await SnapshotStores.inspect({ root, now, retained: () => new Set() })
  expect(stores[0].garbageBytes).toBe(4096 + 2048)
  const preview = await SnapshotStores.prune({ root, stores, orphaned: false, idle: false, dryRun: true, now })
  expect(preview).toMatchObject({ garbageFiles: 1, garbageBytes: 4096, freedBytes: 4096 })
  await expect(fs.stat(path.join(dir, "objects", "pack", "tmp_pack_old"))).resolves.toBeTruthy()
  const done = await SnapshotStores.prune({ root, stores, orphaned: false, idle: false, dryRun: false, now })
  expect(done.freedBytes).toBe(4096)
  await expect(fs.stat(path.join(dir, "objects", "pack", "tmp_pack_old"))).rejects.toMatchObject({ code: "ENOENT" })
  await expect(fs.stat(path.join(dir, "objects", "pack", "tmp_pack_new"))).resolves.toBeTruthy()
  await expect(fs.stat(path.join(dir, "objects", "pack", "pack-real.pack"))).resolves.toBeTruthy()
})

test("prune refuses to delete a store directory that is a symlink or outside the root", async () => {
  await using tmp = await tmpdir()
  const root = path.join(tmp.path, "snapshot")
  const outside = path.join(tmp.path, "outside")
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, "keep.txt"), "keep")
  await fs.mkdir(root)
  await fs.symlink(outside, path.join(root, sha(1)))
  const forged: SnapshotStores.Store = {
    id: sha(1),
    dir: path.join(root, sha(1)),
    worktreeExists: false,
    bytes: 1,
    garbageBytes: 0,
    refs: 0,
    lastActivity: 0,
    state: "orphaned",
  }
  const elsewhere: SnapshotStores.Store = { ...forged, id: sha(2), dir: outside }
  const result = await SnapshotStores.prune({
    root,
    stores: [forged, elsewhere],
    orphaned: true,
    idle: true,
    dryRun: false,
    now,
  })
  expect(result.removed).toEqual([])
  await expect(fs.readFile(path.join(outside, "keep.txt"), "utf8")).resolves.toBe("keep")
})

for (const linkedDirectory of ["objects", "objects/pack"]) {
  test(`prune keeps pack temporaries behind a symlinked ${linkedDirectory} directory`, async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "snapshot")
    const dir = await makeStore(root, sha(1), { idleDays: 30 })
    const outside = path.join(tmp.path, "outside")
    const pack = linkedDirectory === "objects" ? path.join(outside, "pack") : outside
    await fs.mkdir(pack, { recursive: true })
    const target = path.join(pack, "tmp_external")
    await fs.writeFile(target, "keep")
    const old = new Date(now - 30 * DAY)
    await fs.utimes(target, old, old)
    const link = path.join(dir, linkedDirectory)
    await fs.rm(link, { recursive: true })
    await fs.symlink(outside, link, "junction")
    const stores = await SnapshotStores.inspect({ root, now, retained: () => new Set([sha(99)]) })
    // Supply a previously measured garbage size, as if the directory changed after inspection.
    stores[0].garbageBytes = 4
    const result = await SnapshotStores.prune({ root, stores, orphaned: false, idle: false, dryRun: false, now })
    expect(result.garbageFiles).toBe(0)
    await expect(fs.readFile(target, "utf8")).resolves.toBe("keep")
  })
}

test("prune rejects out-of-root rows before clearing pack temporaries", async () => {
  await using tmp = await tmpdir()
  const root = path.join(tmp.path, "snapshot")
  const outside = await makeStore(tmp.path, sha(1), {
    tmp: [{ name: "tmp_external", bytes: 4, ageDays: 30 }],
  })
  const row: SnapshotStores.Store = {
    id: sha(1),
    dir: outside,
    worktreeExists: false,
    bytes: 4,
    garbageBytes: 4,
    refs: 0,
    lastActivity: 0,
    state: "referenced",
  }
  const result = await SnapshotStores.prune({ root, stores: [row], orphaned: false, idle: false, dryRun: false, now })
  expect(result.freedBytes).toBe(0)
  await expect(fs.readFile(path.join(outside, "objects", "pack", "tmp_external"))).resolves.toHaveLength(4)
})

test("inspection preserves stores with missing activity metadata or worktree configuration", async () => {
  await using tmp = await tmpdir()
  const root = path.join(tmp.path, "snapshot")
  const live = path.join(tmp.path, "live")
  await fs.mkdir(live)
  const fresh = await makeStore(root, sha(1), { worktree: live })
  for (const entry of ["index", "refs/snapshots", "ax-code/snapshots"]) {
    await fs.rm(path.join(fresh, entry), { recursive: true })
  }
  await makeStore(root, sha(2), { idleDays: 30 })
  const stores = await SnapshotStores.inspect({ root, now, retained: () => new Set() })
  expect(stores.map((store) => store.state)).toEqual(["unknown", "unknown"])
  const result = await SnapshotStores.prune({ root, stores, orphaned: true, idle: true, dryRun: false, now })
  expect(result.removed).toEqual([])
  await expect(fs.stat(fresh)).resolves.toBeTruthy()
})

test("inspection resolves relative Git worktrees against their store directory", async () => {
  await using tmp = await tmpdir()
  const root = path.join(tmp.path, "snapshot")
  const live = path.join(tmp.path, "live")
  await fs.mkdir(live)
  const dir = await makeStore(root, sha(1), { worktree: "../../live", idleDays: 30 })
  const stores = await SnapshotStores.inspect({ root, now, retained: () => new Set() })
  expect(stores[0]).toMatchObject({ worktree: live, worktreeExists: true, state: "idle" })
  expect(
    (await SnapshotStores.prune({ root, stores, orphaned: true, idle: false, dryRun: false, now })).removed,
  ).toEqual([])
  await expect(fs.stat(dir)).resolves.toBeTruthy()
})

test("inspection decodes quoted Git worktree paths and ignores other sections", async () => {
  await using tmp = await tmpdir()
  const root = path.join(tmp.path, "snapshot")
  const live = path.join(tmp.path, "live#project")
  await fs.mkdir(live)
  const dir = await makeStore(root, sha(1), { idleDays: 30 })
  await fs.writeFile(path.join(dir, "config"), `[other]\nworktree = /missing\n[core]\nworktree = "${live}"\n`)
  const stores = await SnapshotStores.inspect({ root, now, retained: () => new Set() })
  expect(stores[0]).toMatchObject({ worktree: live, worktreeExists: true, state: "idle" })
})

test("prune preserves a store that acquired a retained snapshot after inspection", async () => {
  await using tmp = await tmpdir()
  const root = path.join(tmp.path, "snapshot")
  const dir = await makeStore(root, sha(1), { worktree: path.join(tmp.path, "gone"), idleDays: 30 })
  const stores = await SnapshotStores.inspect({ root, now, retained: () => new Set() })
  const result = await SnapshotStores.prune({
    root,
    stores,
    orphaned: true,
    idle: true,
    dryRun: false,
    now,
    retained: () => new Set([sha(99)]),
  })
  expect(result.removed).toEqual([])
  await expect(fs.stat(dir)).resolves.toBeTruthy()
})

test("prune rechecks activity and remounted worktrees before whole-store deletion", async () => {
  await using tmp = await tmpdir()
  const root = path.join(tmp.path, "snapshot")
  const live = path.join(tmp.path, "live")
  const active = await makeStore(root, sha(1), { worktree: live, idleDays: 30 })
  const remounted = await makeStore(root, sha(2), { worktree: live, idleDays: 30 })
  const stores = await SnapshotStores.inspect({ root, now, retained: () => new Set() })
  await fs.utimes(path.join(active, "index"), new Date(now), new Date(now))
  await fs.mkdir(live)
  const result = await SnapshotStores.prune({
    root,
    stores,
    orphaned: true,
    idle: false,
    dryRun: false,
    now,
    retained: () => new Set(),
  })
  expect(result.removed).toEqual([])
  await expect(fs.stat(active)).resolves.toBeTruthy()
  await expect(fs.stat(remounted)).resolves.toBeTruthy()
})
