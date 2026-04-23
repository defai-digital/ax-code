import path from "path"

export type DoctorCheck = {
  name: string
  status: "ok" | "warn" | "fail"
  detail: string
}

export async function getDoctorDatabaseCheck(input: {
  databasePath: string
  exists?: (target: string) => Promise<boolean>
}): Promise<DoctorCheck> {
  const exists = input.exists ?? (async (target) => Bun.file(target).exists())
  const databasePath = input.databasePath
  const databaseName = path.basename(databasePath)
  const dataDir = path.dirname(databasePath)
  const bundledPath = path.join(dataDir, "ax-code.db")
  const localPath = path.join(dataDir, "ax-code-local.db")
  const currentExists = await exists(databasePath)

  let status: DoctorCheck["status"] = "ok"
  let detail = `${databasePath} (${databaseModeLabel(databaseName)}${currentExists ? "" : ", not created yet"})`

  const alternatePath =
    databaseName === "ax-code.db" ? localPath
      : databaseName === "ax-code-local.db" ? bundledPath
      : undefined

  if (alternatePath && await exists(alternatePath)) {
    status = "warn"
    detail += `; ${databaseModeLabel(path.basename(alternatePath))} also exists at ${alternatePath}; source/dev and packaged installs do not share session state`
  }

  return {
    name: "Data directory",
    status,
    detail,
  }
}

function databaseModeLabel(databaseName: string) {
  if (databaseName === "ax-code.db") return "bundled state"
  if (databaseName === "ax-code-local.db") return "source/dev state"
  return `${databaseName} state`
}
