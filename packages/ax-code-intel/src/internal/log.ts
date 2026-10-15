// Minimal leveled logger for @ax-code/ax-code-intel.
//
// The implementation is shared with @ax-code/ax-code-reason in
// `@ax-code/util/leveled-log`; only the log-level environment variable is
// package-specific. Hosts route entries into their own logger through this
// package's public `setLogSink` facade (the ax-code core does this in
// src/lsp-glue.ts).

import { LeveledLog } from "@ax-code/util/leveled-log"

const runtime = LeveledLog.createRuntime({ levelEnv: "AX_CODEINTEL_LOG_LEVEL" })

export namespace Log {
  export type Extra = LeveledLog.Extra
  export type Level = LeveledLog.Level
  export type Logger = LeveledLog.Logger
  export type Sink = LeveledLog.Sink

  export function setSink(next: Sink | undefined): void {
    runtime.setSink(next)
  }

  export function create(input: { service: string }, tags?: Record<string, string>): Logger {
    return runtime.create(input, tags)
  }
}
