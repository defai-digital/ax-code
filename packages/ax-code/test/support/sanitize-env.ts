// Deletes inherited ax-code runtime flags from an environment so the vitest
// suite behaves identically whether it is launched from a clean shell (CI) or
// from inside an ax-code session. ax-code exports AX_CODE_* runtime policy
// flags (AX_CODE_ISOLATION_MODE, AX_CODE_AUTONOMOUS, ...) to child processes,
// and src/flag reads them at access time with intentional priority over config
// (the --sandbox CLI flag sets the env in yargs middleware and relies on it).
// Without sanitization, tests constructing Isolation.resolve({ mode:
// "read-only" }) silently run under the host session's full-access policy —
// sandbox assertions fail or, worse, silently weaken.
//
// Runs in two places (both idempotent):
// 1. vitest.config.ts module evaluation — the coordinator process, before any
//    worker forks, so forked workers inherit a sanitized env regardless of
//    setupFiles execution order (vitest does not guarantee array order).
// 2. test/support/vitest.env.ts, the first setupFiles entry — defense in
//    depth for workers, covering any env path that bypasses config eval.
//
// AX_CODE_PROFILE_NATIVE is preserved: it is an opt-in profiling switch the
// developer sets deliberately when launching the suite (read in preload.ts).
// AX_CODE_TEST_* values need no preservation — preload.ts re-asserts them
// per-PID after this runs.

export function sanitizeAxCodeEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const deleted: string[] = []
  for (const key of Object.keys(env)) {
    if (key === "AX_CODE_PROFILE_NATIVE") continue
    // "AX_CODE" (exact) is the inside-an-ax-code-session marker the host
    // exports alongside AX_CODE_PID / AX_CODE_ORIGINAL_CWD; drop it too so
    // tests can't observe host-session state.
    if (key === "AX_CODE" || key.startsWith("AX_CODE_")) {
      delete env[key]
      deleted.push(key)
    }
  }
  return deleted
}
