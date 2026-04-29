import path from "path"
import { stat } from "node:fs/promises"
import { DurableStoragePolicy } from "../../storage/policy"

export type DoctorCheck = {
  name: string
  status: "ok" | "warn" | "fail"
  detail: string
}

type DatabaseFileInfo = {
  exists: boolean
  size?: number
  error?: string
}

const LARGE_WAL_BYTES = DurableStoragePolicy.journalSizeLimitBytes

export async function getDoctorDatabaseCheck(input: {
  databasePath: string
  exists?: (target: string) => Promise<boolean>
  inspect?: (target: string) => Promise<DatabaseFileInfo>
}): Promise<DoctorCheck> {
  const inspect = input.inspect ?? (input.exists ? inspectWithExists(input.exists) : inspectWithStat)
  const databasePath = input.databasePath
  const databaseName = path.basename(databasePath)
  const dataDir = path.dirname(databasePath)
  const bundledPath = path.join(dataDir, "ax-code.db")
  const localPath = path.join(dataDir, "ax-code-local.db")
  const current = await inspect(databasePath)
  const wal = await inspect(`${databasePath}-wal`)
  const shm = await inspect(`${databasePath}-shm`)

  let status: DoctorCheck["status"] = "ok"
  const markWarn = () => {
    if (status !== "fail") status = "warn"
  }
  const details = [`${databasePath} (${databaseModeLabel(databaseName)}${current.exists ? "" : ", not created yet"})`]

  const readErrors = [
    current.error ? `${databaseName}: ${current.error}` : undefined,
    wal.error ? `${databaseName}-wal: ${wal.error}` : undefined,
    shm.error ? `${databaseName}-shm: ${shm.error}` : undefined,
  ].filter(Boolean)

  if (readErrors.length > 0) {
    status = "fail"
    details.push(`cannot inspect database files: ${readErrors.join("; ")}`)
  }

  if (!current.exists && (wal.exists || shm.exists)) {
    markWarn()
    details.push("SQLite sidecar exists without the main database")
  }

  if (wal.exists && (wal.size ?? 0) >= LARGE_WAL_BYTES) {
    markWarn()
    details.push(`large WAL file: ${formatBytes(wal.size ?? 0)}`)
  } else if (wal.exists && wal.size !== undefined) {
    details.push(`WAL ${formatBytes(wal.size)}`)
  }

  if (shm.exists && shm.size !== undefined) {
    details.push(`SHM ${formatBytes(shm.size)}`)
  }

  const alternatePath =
    databaseName === "ax-code.db" ? localPath : databaseName === "ax-code-local.db" ? bundledPath : undefined

  if (alternatePath && (await inspect(alternatePath)).exists) {
    markWarn()
    details.push(
      `${databaseModeLabel(path.basename(alternatePath))} also exists at ${alternatePath}; source/dev and packaged installs do not share session state`,
    )
  }

  return {
    name: "Data directory",
    status,
    detail: details.join("; "),
  }
}

function databaseModeLabel(databaseName: string) {
  if (databaseName === "ax-code.db") return "bundled state"
  if (databaseName === "ax-code-local.db") return "source/dev state"
  return `${databaseName} state`
}

function inspectWithExists(exists: (target: string) => Promise<boolean>) {
  return async (target: string): Promise<DatabaseFileInfo> => ({ exists: await exists(target) })
}

async function inspectWithStat(target: string): Promise<DatabaseFileInfo> {
  try {
    const result = await stat(target)
    return { exists: true, size: result.size }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return { exists: false }
    return {
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`
  return `${Math.round(bytes / 1024 / 1024)} MiB`
}
