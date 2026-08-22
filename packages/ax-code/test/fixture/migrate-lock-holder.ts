import { MigrationLock } from "../../src/storage/migrate-lock"

const dbPath = process.argv[2]
const holdMs = Number(process.argv[3])
if (!dbPath || !Number.isFinite(holdMs) || holdMs < 0) {
  throw new Error("usage: migrate-lock-holder.ts <db-path> <hold-ms>")
}

process.stdout.write("attempting\n")
const release = MigrationLock.acquire(dbPath)
try {
  process.stdout.write("locked\n")
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs)
} finally {
  release()
}
