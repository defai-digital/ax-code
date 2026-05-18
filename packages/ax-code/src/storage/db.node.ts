import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"
import { closeSync, mkdirSync, openSync } from "node:fs"
import { dirname } from "node:path"

export function init(path: string) {
  // node:sqlite has no "create if missing" flag (unlike bun:sqlite's
  // `{ create: true }`). Ensure the directory and file exist before opening,
  // otherwise the first run on a fresh install throws ENOENT before any
  // migration can run.
  mkdirSync(dirname(path), { recursive: true })
  closeSync(openSync(path, "a"))
  const sqlite = new DatabaseSync(path, { open: true, readOnly: false })
  const db = drizzle({ client: sqlite })
  return db
}
