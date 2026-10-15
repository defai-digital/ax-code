import { spawnSync } from "node:child_process"
import * as fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { describe, expect, test } from "vitest"
import { Filesystem } from "../src/filesystem"

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await fs.mkdtemp(join(tmpdir(), "ax-filesystem-mode-"))
  try {
    await run(directory)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === "win32")("atomic write permissions", () => {
  test.each([0o600, 0o755])("stream overwrites preserve existing mode %i", async (mode) => {
    await withDirectory(async (directory) => {
      const target = join(directory, "target")
      await fs.writeFile(target, "old")
      await fs.chmod(target, mode)
      await Filesystem.writeStream(target, Readable.from(["replacement"]))
      expect((await fs.stat(target)).mode & 0o777).toBe(mode)
      expect(await fs.readFile(target, "utf8")).toBe("replacement")
    })
  })

  test("an explicit zero mode is retained by streamed writes", async () => {
    await withDirectory(async (directory) => {
      const target = join(directory, "target")
      await Filesystem.writeStream(target, Readable.from(["private"]), 0)
      expect((await fs.stat(target)).mode & 0o777).toBe(0)
    })
  })

  test("a restrictive umask does not strip preserved or explicitly requested bits", () => {
    const source = `
      import * as fs from "node:fs/promises"
      import { tmpdir } from "node:os"
      import { join } from "node:path"
      import { Readable } from "node:stream"
      import { Filesystem } from ${JSON.stringify(new URL("../src/filesystem.ts", import.meta.url).href)}
      process.umask(0o077)
      const directory = await fs.mkdtemp(join(tmpdir(), "ax-filesystem-umask-"))
      try {
        const target = join(directory, "script")
        await fs.writeFile(target, "old")
        await fs.chmod(target, 0o755)
        await Filesystem.write(target, "new")
        const written = (await fs.stat(target)).mode & 0o777
        await fs.chmod(target, 0o755)
        await Filesystem.writeStream(target, Readable.from(["stream"]))
        const streamed = (await fs.stat(target)).mode & 0o777
        const explicit = join(directory, "explicit")
        await Filesystem.writeStream(explicit, Readable.from(["explicit"]), 0o755)
        console.log([written, streamed, (await fs.stat(explicit)).mode & 0o777].join(","))
      } finally {
        await fs.rm(directory, { recursive: true, force: true })
      }
    `
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
      timeout: 15_000,
    })
    expect(child.status, child.stderr).toBe(0)
    expect(child.stdout.trim()).toBe("493,493,493")
  })
})
