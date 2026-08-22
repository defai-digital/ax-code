// Public logging facade for @ax-code/ax-code-intel.
//
// Deliberately minimal: hosts route the package's internal log stream into
// their own logging stack via setLogSink() (the ax-code core does this in
// src/lsp-glue.ts), and createLogger() emits onto that same stream — which is
// also how a host verifies the wiring end to end. The implementation lives in
// src/internal/log.ts, which is not part of the public API.

import { Log } from "./internal/log"

export type LogSink = Log.Sink
export type LogLevel = Log.Level
export type Logger = Log.Logger

export function setLogSink(sink: LogSink | undefined): void {
  Log.setSink(sink)
}

export function createLogger(input: { service: string }): Logger {
  return Log.create(input)
}
