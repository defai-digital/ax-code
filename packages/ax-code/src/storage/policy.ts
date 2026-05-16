export const DurableStoragePolicy = {
  // Keep SQLite's built-in WAL as the batching/durability boundary instead
  // of introducing an app-level in-memory database with background sync.
  // This preserves SQLite's cross-process locking and crash-recovery
  // semantics while still reducing immediate fsync pressure.
  busyTimeoutMs: 15_000,
  journalMode: "WAL",
  synchronous: "NORMAL",
  cacheSizeKiB: 64 * 1024,
  tempStore: "MEMORY",
  walAutoCheckpointPages: 1_000,
  journalSizeLimitBytes: 64 * 1024 * 1024,
  shutdownCheckpointMode: "TRUNCATE",
} as const

export function describeDurableStoragePolicy() {
  return [
    `SQLite policy: journal ${DurableStoragePolicy.journalMode}`,
    `synchronous ${DurableStoragePolicy.synchronous}`,
    `busy timeout ${DurableStoragePolicy.busyTimeoutMs}ms`,
    `WAL autocheckpoint ${DurableStoragePolicy.walAutoCheckpointPages} pages`,
    `journal limit ${formatPolicyBytes(DurableStoragePolicy.journalSizeLimitBytes)}`,
  ].join(", ")
}

function formatPolicyBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`
  return `${Math.round(bytes / 1024 / 1024)} MiB`
}
