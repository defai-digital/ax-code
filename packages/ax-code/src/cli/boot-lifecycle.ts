import { DiagnosticLog } from "../debug/diagnostic-log"
import { Log } from "../util/log"
import { isHarmlessInterrupt } from "../util/harmless-interrupt"
import { initNetworkEnv } from "../util/network-env"
import { toErrorMessage } from "../util/error-message"
import { ProcessRegistry } from "../runtime/process-registry"

// Process-lifecycle machinery shared by cli/boot.ts (full CLI) and
// cli/boot-node.ts (doctor/generate-only build): forced-exit timer and the
// process error hooks. Both entry points must behave identically here.

let forcedExitTimer: ReturnType<typeof setTimeout> | undefined
let hooksInstalled = false

function onUnhandledRejection(err: unknown) {
  if (isHarmlessInterrupt(err)) return
  DiagnosticLog.recordProcess("cli.unhandledRejection", { error: err })
  Log.Default.error("rejection", {
    e: err instanceof Error ? err.message : err,
  })
  process.exitCode = 1
}

function onUncaughtException(err: Error) {
  if (isHarmlessInterrupt(err)) return
  DiagnosticLog.recordProcess("cli.uncaughtException", { error: err })
  Log.Default.error("exception", {
    e: err instanceof Error ? err.message : err,
  })
  // Process state is unreliable after uncaught exception; keep this timer
  // referenced so diagnostic logs have a chance to flush before exit.
  setTimeout(() => process.exit(1), 100)
}

export function clearForcedExitTimer() {
  if (!forcedExitTimer) return
  clearTimeout(forcedExitTimer)
  forcedExitTimer = undefined
}

/** Grace period for WAL checkpoint / log flush before forced process exit (STAB-13). */
export const FORCED_EXIT_GRACE_MS = 2_000

export function scheduleForcedExit(exit: () => void = () => process.exit()) {
  clearForcedExitTimer()
  forcedExitTimer = setTimeout(() => {
    forcedExitTimer = undefined
    exit()
  }, FORCED_EXIT_GRACE_MS)
  forcedExitTimer.unref?.()
  return forcedExitTimer
}

export function hooks() {
  if (hooksInstalled) return
  hooksInstalled = true
  // Enable proxy env support and the system CA store before any provider, MCP,
  // or models.dev request. Shared by every CLI entry point (and harmless when
  // the TUI worker thread calls it again: init is idempotent).
  initNetworkEnv()
  process.on("unhandledRejection", onUnhandledRejection)
  process.on("uncaughtException", onUncaughtException)
  // ADR-209: sweep child-process registry entries whose owner died hard
  // (OOM, SIGKILL, a node:ffi crash). Fire-and-forget with a catch: the
  // sweep must never block or fail startup, and it is a no-op on Windows
  // and when the registry directory does not exist yet.
  void ProcessRegistry.sweepOrphans().catch((error) => {
    Log.Default.warn("child process orphan sweep failed", { error: toErrorMessage(error) })
  })
}
