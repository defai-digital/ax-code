import { $ } from "bun"
import { afterEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Bus } from "../../src/bus"
import { FileWatcher } from "../../src/file/watcher"
import { Instance } from "../../src/project/instance"

// Native @parcel/watcher bindings aren't reliably available in CI (missing on Linux, flaky on Windows)
const describeWatcher = FileWatcher.hasNativeBinding() && !process.env.CI ? describe : describe.skip

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type WatcherEvent = { file: string; event: "add" | "change" | "unlink" }

/** Run `body` with a live FileWatcher service. */
function withWatcher(directory: string, body: () => Promise<void>) {
  return Instance.provide({
    directory,
    fn: async () => {
      try {
        await FileWatcher.init({ enabled: true, disabled: false })
        await ready(directory)
        await body()
      } finally {
        await Instance.dispose()
      }
    },
  })
}

function listen(directory: string, check: (evt: WatcherEvent) => boolean, hit: (evt: WatcherEvent) => void) {
  let done = false

  const unsub = Bus.subscribe(FileWatcher.Event.Updated, (evt) => {
    if (done) return
    if (!check(evt.properties)) return
    hit(evt.properties)
  })

  return () => {
    if (done) return
    done = true
    unsub()
  }
}

function nextUpdate(
  directory: string,
  check: (evt: WatcherEvent) => boolean,
  trigger: () => Promise<void>,
): Promise<WatcherEvent> {
  return new Promise((resolve, reject) => {
    const cleanup = listen(directory, check, (evt) => {
      cleanup()
      clearTimeout(timer)
      resolve(evt)
    })

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for watcher event"))
    }, 5_000)

    void trigger().catch((error) => {
      cleanup()
      clearTimeout(timer)
      reject(error)
    })
  })
}

/** Assert that no matching event arrives within `ms`. */
function noUpdate(directory: string, check: (evt: WatcherEvent) => boolean, trigger: () => Promise<void>, ms = 500) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = listen(directory, check, (evt) => {
      cleanup()
      clearTimeout(timer)
      reject(new Error(`Unexpected watcher event: ${JSON.stringify(evt)}`))
    })

    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    void trigger().catch((error) => {
      cleanup()
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function ready(directory: string) {
  const file = path.join(directory, `.watcher-${Math.random().toString(36).slice(2)}`)
  const head = path.join(directory, ".git", "HEAD")

  try {
    await nextUpdate(
      directory,
      (evt) => evt.file === file && evt.event === "add",
      () => fs.writeFile(file, "ready"),
    )
  } finally {
    await fs.rm(file, { force: true }).catch(() => undefined)
  }

  const git = await fs
    .stat(head)
    .then(() => true)
    .catch(() => false)
  if (!git) return

  const branch = `watch-${Math.random().toString(36).slice(2)}`
  const hash = await $`git rev-parse HEAD`.cwd(directory).quiet().text()
  await nextUpdate(
    directory,
    (evt) => evt.file === head && evt.event !== "unlink",
    async () => {
      await fs.writeFile(path.join(directory, ".git", "refs", "heads", branch), hash.trim() + "\n")
      await fs.writeFile(head, `ref: refs/heads/${branch}\n`)
    },
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileWatcher native event decoding", () => {
  test("parseNativeWatcherEvents decodes valid native events", () => {
    expect(
      FileWatcher.parseNativeWatcherEvents(JSON.stringify([{ eventType: "change", path: "src/index.ts" }])),
    ).toEqual([{ eventType: "change", path: "src/index.ts" }])
  })

  test("parseNativeWatcherEvents rejects malformed native events", () => {
    expect(() => FileWatcher.parseNativeWatcherEvents("{not json")).toThrow(SyntaxError)
    expect(() =>
      FileWatcher.parseNativeWatcherEvents(JSON.stringify({ eventType: "change", path: "src/index.ts" })),
    ).toThrow(SyntaxError)
    expect(() =>
      FileWatcher.parseNativeWatcherEvents(JSON.stringify([{ eventType: "rename", path: "src/index.ts" }])),
    ).toThrow(SyntaxError)
    expect(() => FileWatcher.parseNativeWatcherEvents(JSON.stringify([{ eventType: "change", path: 123 }]))).toThrow(
      SyntaxError,
    )
  })

  test("poll snapshots do not treat unreadable directories as empty", async () => {
    await using tmp = await tmpdir()
    const blocked = path.join(tmp.path, "blocked")
    await fs.mkdir(blocked)
    await fs.writeFile(path.join(blocked, "file.txt"), "content")
    await fs.chmod(blocked, 0)

    try {
      await expect(FileWatcher.snapshotPollTree(blocked, [])).rejects.toMatchObject({ code: "EACCES" })
    } finally {
      await fs.chmod(blocked, 0o700).catch(() => undefined)
    }
  })

  test("poll snapshots still treat missing directories as empty", async () => {
    await using tmp = await tmpdir()

    await expect(FileWatcher.snapshotPollTree(path.join(tmp.path, "missing"), [])).resolves.toEqual(new Map())
  })
})

describeWatcher("FileWatcher", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("publishes root create, update, and delete events", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "watch.txt")
    const dir = tmp.path
    const cases = [
      { event: "add" as const, trigger: () => fs.writeFile(file, "a") },
      { event: "change" as const, trigger: () => fs.writeFile(file, "b") },
      { event: "unlink" as const, trigger: () => fs.unlink(file) },
    ]

    await withWatcher(dir, async () => {
      for (const { event, trigger } of cases) {
        const evt = await nextUpdate(dir, (evt) => evt.file === file && evt.event === event, trigger)
        expect(evt).toEqual({ file, event })
      }
    })
  })

  test("watches non-git roots", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "plain.txt")
    const dir = tmp.path

    await withWatcher(dir, async () => {
      const evt = await nextUpdate(
        dir,
        (e) => e.file === file && e.event === "add",
        () => fs.writeFile(file, "plain"),
      )
      expect(evt).toEqual({ file, event: "add" })
    })
  })

  test("cleanup stops publishing events", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "after-dispose.txt")

    // Start and immediately stop the watcher (withWatcher disposes on exit)
    await withWatcher(tmp.path, async () => {})

    // Now write a file — no watcher should be listening
    await Instance.provide({
      directory: tmp.path,
      fn: () =>
        noUpdate(
          tmp.path,
          (e) => e.file === file,
          () => fs.writeFile(file, "gone"),
        ),
    })
  })

  test("rebuilds watcher when init options change", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "reconfigured.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          await FileWatcher.init({ enabled: false, disabled: true })
          await FileWatcher.init({ enabled: true, disabled: false })
          await ready(tmp.path)

          const evt = await nextUpdate(
            tmp.path,
            (e) => e.file === file && e.event === "add",
            () => fs.writeFile(file, "live"),
          )

          expect(evt).toEqual({ file, event: "add" })
        } finally {
          await Instance.dispose()
        }
      },
    })
  })

  test("ignores .git/index changes", async () => {
    await using tmp = await tmpdir({ git: true })
    const gitIndex = path.join(tmp.path, ".git", "index")
    const edit = path.join(tmp.path, "tracked.txt")

    await withWatcher(tmp.path, () =>
      noUpdate(
        tmp.path,
        (e) => e.file === gitIndex,
        async () => {
          await fs.writeFile(edit, "a")
          await $`git add .`.cwd(tmp.path).quiet().nothrow()
        },
      ),
    )
  })

  test("publishes .git/HEAD events", async () => {
    await using tmp = await tmpdir({ git: true })
    const head = path.join(tmp.path, ".git", "HEAD")
    const branch = `watch-${Math.random().toString(36).slice(2)}`
    await $`git branch ${branch}`.cwd(tmp.path).quiet()

    await withWatcher(tmp.path, async () => {
      const evt = await nextUpdate(
        tmp.path,
        (evt) => evt.file === head && evt.event !== "unlink",
        () => fs.writeFile(head, `ref: refs/heads/${branch}\n`),
      )
      expect(evt.file).toBe(head)
      expect(["add", "change"]).toContain(evt.event)
    })
  })
})
