import { DatabaseSync } from "node:sqlite"

const [dbPath, id, payloadJson, holdMsRaw] = process.argv.slice(2)
const holdMs = Number(holdMsRaw)
if (!dbPath || !id || payloadJson === undefined || !Number.isFinite(holdMs) || holdMs < 0) {
  throw new Error("usage: queue-claim-edit-holder.ts <db-path> <row-id> <payload-json> <hold-ms>")
}

const db = new DatabaseSync(dbPath)
db.exec("PRAGMA busy_timeout = 15000")
// Hold the write lock with an uncommitted payload edit so the parent's claim
// races exactly the foreign-process edit described in the task-queue claim
// audit: the claim must serialize behind this commit, not clobber it.
db.exec("BEGIN IMMEDIATE")
db.prepare("UPDATE task_queue SET payload = ?, time_updated = ? WHERE id = ?").run(payloadJson, Date.now(), id)
process.stdout.write("locked\n")
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs)
db.exec("COMMIT")
db.close()
