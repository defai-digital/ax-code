import { sanitizeAxCodeEnv } from "./sanitize-env"

// First entry in vitest.config.ts setupFiles. Must stay a single import plus
// call: ESM evaluates this module's graph before test/support/vitest.setup.ts
// (which imports src/ modules), so the sanitizer runs before any product code
// can capture AX_CODE_* flags at module init. vitest.config.ts also calls the
// sanitizer at config-evaluation time in the coordinator; this worker-side
// call is idempotent defense in depth. See sanitize-env.ts for the rationale.
sanitizeAxCodeEnv()
