// Test shim: map bun:sqlite's `Database` to node:sqlite's `DatabaseSync` so
// tests that construct a SQLite database directly (rather than via #db) run
// under Node. Paired with the drizzle-orm/bun-sqlite → node-sqlite aliases in
// vitest.config.ts. The surface these tests use — `new Database(path)`,
// `.exec()`, and handing the client to drizzle — is identical across both.
export { DatabaseSync as Database } from "node:sqlite"
