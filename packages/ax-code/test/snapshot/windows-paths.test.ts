import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { Snapshot } from "@/snapshot"
import { WindowsSnapshotPaths } from "@/snapshot/windows-paths"
import { Instance } from "@/project/instance"
import { Global } from "@/global"
import { Bus } from "@/bus"
import { NotificationEvent } from "@/notification/events"
import { git } from "@/util/git"
import { Process } from "@/util/process"
import { tmpdir } from "../fixture/fixture"

const reserved = [
  "NUL",
  "CON",
  "PRN",
  "AUX",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
  "COM¹",
  "COM²",
  "COM³",
  "LPT¹",
  "LPT²",
  "LPT³",
  "nul",
  "con.txt",
  "PRN.log",
  "AUX.json",
  "NUL.txt",
  "COM1.txt",
  "LPT9.log",
  "nested/CON",
  "AUX/child.txt",
]
const valid = ["normal.txt", "CONSOLE.txt", "AUXILIARY.txt", "COM10", "LPT10", "null"]
const native = (file: string) => path.toNamespacedPath(file)
async function write(root: string, file: string, content = "reserved-name regression fixture\n") {
  await fs.mkdir(native(path.dirname(path.join(root, file))), { recursive: true })
  await fs.writeFile(native(path.join(root, file)), content)
}
function store() {
  return path.join(Global.Path.data, "snapshot", Instance.project.id)
}
async function snapshotGit(command: string[]) {
  return git(["-c", "core.protectNTFS=false", "--git-dir", store(), "--work-tree", Instance.worktree, ...command], {
    cwd: Instance.worktree,
  })
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

test("inspects cached and untracked paths together when staging a snapshot", async () => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(WindowsSnapshotPaths, "enabled").mockReturnValue(true)
  await write(tmp.path, "normal.txt")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Snapshot.track()
      await write(tmp.path, "normal.txt", "changed\n")
      await write(tmp.path, "new.txt")
      const run = vi.spyOn(Process, "run")
      const tree = await Snapshot.track()
      const scans = run.mock.calls.map(([command]) => command).filter((command) => command.includes("ls-files"))
      expect(scans.filter((command) => command.includes("--others"))).toHaveLength(1)
      expect(scans.find((command) => command.includes("--others"))).toEqual(
        expect.arrayContaining(["--cached", "--others", "--exclude-standard", "-t", "-z"]),
      )
      expect((await snapshotGit(["ls-tree", "-r", "--name-only", tree!])).text()).toContain("new.txt")
    },
  })
})

test("classifies all reported reserved paths and valid near-matches", () => {
  for (const file of [...reserved, "safe/nUl.txt", "dir/COM².log", "CON .txt", "ordinary.", "ordinary "])
    expect(WindowsSnapshotPaths.unsupported(file), file).toBe(true)
  for (const file of [...valid, "dir/.hidden", "COM0", "COM⁴", " leading.txt"])
    expect(WindowsSnapshotPaths.unsupported(file), file).toBe(false)
})

test("snapshots and restores normal files while preserving excluded Windows paths", async () => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(WindowsSnapshotPaths, "enabled").mockReturnValue(true)
  const excluded = reserved.map((name, i) => `case-${i}/${name}`)
  excluded.push("literal[1]/NUL", "line\nbreak/CON")
  // Windows cannot create a component containing a newline through ordinary APIs.
  if (process.platform === "win32") excluded.pop()
  for (const file of [...excluded, ...valid, "literal1/normal.txt", "ignored/NUL"]) await write(tmp.path, file)
  await write(tmp.path, ".gitignore", "/ignored/\n")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const warnings: string[] = []
      Bus.subscribe(NotificationEvent.ToastShow, (event) => {
        warnings.push(event.properties.message)
      })
      const baseline = (await Snapshot.track())!
      expect(baseline).toMatch(/^[a-f0-9]{40}$/)
      expect(await Snapshot.track()).toBe(baseline)
      const tree = (await snapshotGit(["ls-tree", "-r", "--name-only", "-z", baseline])).text().split("\0")
      for (const file of excluded) expect(tree).not.toContain(file)
      for (const file of valid) expect(tree).toContain(file)
      expect(tree).toContain("literal1/normal.txt")
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("rollback")
      expect(warnings[0]).toContain("NUL")
      expect(warnings[0]).not.toContain("ignored/NUL")
      await write(tmp.path, "normal.txt", "changed\n")
      await write(tmp.path, excluded[0], "excluded remains changed\n")
      await Snapshot.restore(baseline)
      expect(await fs.readFile(path.join(tmp.path, "normal.txt"), "utf8")).toBe("reserved-name regression fixture\n")
      expect(await fs.readFile(native(path.join(tmp.path, excluded[0])), "utf8")).toBe("excluded remains changed\n")
      expect(await fs.readFile(path.join(tmp.path, ".gitignore"), "utf8")).toBe("/ignored/\n")
    },
  })
})

test("rejects an unsupported historical index entry without removing it", async () => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(WindowsSnapshotPaths, "enabled").mockReturnValue(true)
  await write(tmp.path, "normal.txt")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Snapshot.track()
      const blob = (await snapshotGit(["hash-object", "-w", "normal.txt"])).text().trim()
      expect((await snapshotGit(["update-index", "--add", "--cacheinfo", `100644,${blob},NUL`])).exitCode).toBe(0)
      const before = (await snapshotGit(["ls-files", "-z"])).text()
      await expect(Snapshot.track()).rejects.toThrow("snapshot index")
      expect((await snapshotGit(["ls-files", "-z"])).text()).toBe(before)
    },
  })
})

test("rejects unsupported restore targets before changing the current index", async () => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(WindowsSnapshotPaths, "enabled").mockReturnValue(true)
  await write(tmp.path, "normal.txt")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = (await Snapshot.track())!
      const blob = (await snapshotGit(["hash-object", "-w", "normal.txt"])).text().trim()
      expect((await snapshotGit(["update-index", "--add", "--cacheinfo", `100644,${blob},NUL`])).exitCode).toBe(0)
      const unsupported = (await snapshotGit(["write-tree"])).text().trim()
      expect((await snapshotGit(["read-tree", baseline])).exitCode).toBe(0)
      const index = (await snapshotGit(["ls-files", "-z"])).text()
      await expect(Snapshot.restore(unsupported)).rejects.toThrow("requested snapshot tree")
      expect((await snapshotGit(["ls-files", "-z"])).text()).toBe(index)
      expect(await fs.readFile(path.join(tmp.path, "normal.txt"), "utf8")).toBe("reserved-name regression fixture\n")
    },
  })
})

test.skipIf(process.platform === "win32")("non-Windows snapshots retain otherwise valid device filenames", async () => {
  await using tmp = await tmpdir({ git: true })
  await write(tmp.path, "NUL")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const tree = (await Snapshot.track())!
      expect((await snapshotGit(["ls-tree", "-r", "--name-only", "-z", tree])).text()).toContain("NUL\0")
    },
  })
})

test("ignored device paths do not generate a rollback warning", async () => {
  await using tmp = await tmpdir({ git: true })
  vi.spyOn(WindowsSnapshotPaths, "enabled").mockReturnValue(true)
  for (const file of ["NUL", "CON", "PRN", "AUX", "normal.txt"]) await write(tmp.path, file)
  await write(tmp.path, ".gitignore", "/NUL\n/CON\n")
  await write(tmp.path, ".git/info/exclude", "/PRN\n/AUX\n")
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const warnings: string[] = []
      Bus.subscribe(NotificationEvent.ToastShow, (event) => {
        warnings.push(event.properties.message)
      })
      const tree = (await Snapshot.track())!
      expect((await snapshotGit(["ls-tree", "-r", "--name-only", "-z", tree])).text()).toContain("normal.txt\0")
      expect(warnings).toEqual([])
    },
  })
})
