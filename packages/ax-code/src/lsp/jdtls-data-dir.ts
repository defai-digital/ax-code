import fs from "fs/promises"
import os from "os"
import path from "path"
import { log } from "./server-helpers"

const DATA_DIR_PREFIX = "ax-code-jdtls-data"
const STALE_DATA_DIR_MS = 24 * 60 * 60 * 1000

export namespace JdtlsDataDir {
  export async function create() {
    return fs.mkdtemp(path.join(os.tmpdir(), DATA_DIR_PREFIX))
  }

  export async function remove(dataDir: string) {
    await fs.rm(dataDir, { recursive: true, force: true })
  }

  export async function cleanupStale() {
    const tmp = os.tmpdir()
    const entries = await fs.readdir(tmp).catch(() => [])
    const cutoff = Date.now() - STALE_DATA_DIR_MS
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.startsWith(DATA_DIR_PREFIX)) return
        const full = path.join(tmp, entry)
        const stat = await fs.stat(full).catch(() => undefined)
        if (!stat?.isDirectory() || stat.mtimeMs >= cutoff) return
        await remove(full).catch((err) => log.warn("failed to remove stale jdtls data dir", { dataDir: full, err }))
      }),
    )
  }
}
