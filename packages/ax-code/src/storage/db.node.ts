import { DatabaseSync } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"

export function init(path: string) {
  const sqlite = new DatabaseSync(path, { open: true, readOnly: false })
  const db = drizzle({ client: sqlite })
  return db
}
