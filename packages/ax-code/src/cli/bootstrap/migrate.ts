import { EOL } from "os"
import { Database } from "../../storage/db"
import { JsonMigration } from "../../storage/json-migration"
import { Filesystem } from "../../util/filesystem"

export type MigrateDep = {
  path?: string
  exists?: (path: string) => Promise<boolean>
  db?: () => Parameters<typeof JsonMigration.run>[0]
  run?: (
    db: Parameters<typeof JsonMigration.run>[0],
    opts?: Parameters<typeof JsonMigration.run>[1],
  ) => Promise<unknown>
  err?: {
    isTTY?: boolean
    write(text: string): unknown
  }
}

export async function migrate(dep: MigrateDep = {}) {
  const path = dep.path ?? Database.Path
  const exists = dep.exists ?? Filesystem.exists
  const db = dep.db ?? (() => Database.Client().$client)
  const run = dep.run ?? JsonMigration.run
  const err = dep.err ?? process.stderr

  if (await exists(path)) return false

  const tty = !!err.isTTY
  err.write("Performing one time database migration, may take a few minutes..." + EOL)
  const width = 36
  const orange = "\x1b[38;5;214m"
  const muted = "\x1b[0;2m"
  const reset = "\x1b[0m"
  let last = -1
  if (tty) err.write("\x1b[?25l")
  try {
    await run(db(), {
      progress: (event) => {
        const percent = Math.floor((event.current / event.total) * 100)
        if (percent === last && event.current !== event.total) return
        last = percent
        if (tty) {
          const fill = Math.round((percent / 100) * width)
          const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
          err.write(
            `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.label.padEnd(12)} ${event.current}/${event.total}${reset}`,
          )
          if (event.current === event.total) err.write("\n")
          return
        }
        err.write(`sqlite-migration:${percent}${EOL}`)
      },
    })
  } finally {
    if (tty) err.write("\x1b[?25h")
    else err.write(`sqlite-migration:done${EOL}`)
  }
  err.write("Database migration complete." + EOL)
  return true
}
