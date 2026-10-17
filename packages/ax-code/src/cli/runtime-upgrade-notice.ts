// Post-upgrade notice for runtime servers still on the old version (ADR-251).
// Pure helpers so the upgrade command can be tested with fake registry records
// without touching the filesystem or spawning anything.

/** Minimal registry record view the notice needs. */
export type RuntimeServerRecord = {
  /** Project directory the server serves (the `--dir` of its restart command). */
  directory: string
  /** ax-code version the running server reports. */
  version: string
}

export type StaleRuntimeServer = {
  directory: string
  version: string
  /** Exact command the user can run to move the server onto the new version. */
  restartCommand: string
}

/** Restart command for one recorded server (never executed automatically). */
export function runtimeRestartCommand(directory: string): string {
  return `ax-code runtime restart --dir ${directory}`
}

/**
 * Registered runtime servers whose version differs from `targetVersion`.
 * Sorted by directory for a stable, deterministic notice.
 */
export function staleRuntimeServers(
  records: readonly RuntimeServerRecord[],
  targetVersion: string,
): StaleRuntimeServer[] {
  return records
    .filter((record) => record.version !== targetVersion)
    .map((record) => ({
      directory: record.directory,
      version: record.version,
      restartCommand: runtimeRestartCommand(record.directory),
    }))
    .sort((a, b) => (a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : 0))
}

/**
 * One line per stale server, or an empty array when every server is current
 * (so the caller prints nothing).
 */
export function renderStaleRuntimeServers(servers: readonly StaleRuntimeServer[], targetVersion: string): string[] {
  if (servers.length === 0) return []
  const header = `${servers.length} runtime server${servers.length === 1 ? "" : "s"} still running an older version; restart to use v${targetVersion}:`
  return [header, ...servers.map((server) => `  ${server.directory} (v${server.version}) — ${server.restartCommand}`)]
}

/**
 * Read the runtime registry and render the post-upgrade notice. Returns an
 * empty array when nothing is stale; callers treat a registry read failure as
 * "nothing to report" so a broken registry never fails an upgrade.
 */
export async function staleRuntimeNotice(targetVersion: string): Promise<string[]> {
  const { RuntimeRegistry } = await import("@/runtime/runtime-registry")
  const records = (await RuntimeRegistry.list()).map((entry) => entry.record)
  return renderStaleRuntimeServers(staleRuntimeServers(records, targetVersion), targetVersion)
}
