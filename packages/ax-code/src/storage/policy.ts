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
    `journal limit ${formatStorageBytes(DurableStoragePolicy.journalSizeLimitBytes)}`,
  ].join(", ")
}

/** Format storage sizes without rounded values overflowing into the next unit. */
export function formatStorageBytes(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const
  let value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  let unit = 0
  while (unit < units.length - 1 && Math.round(value) >= 1024) {
    value /= 1024
    unit += 1
  }
  return `${Math.round(value)} ${units[unit]}`
}
