"use strict"

const crypto = require("crypto")

// ── Per-boot ax-code runtime auth password ──────────────────────────────────
// SPEC-2026-08-29-desktop-process-model-collapse §2 D2 / §5 S2.2: the Electron
// main process owns the per-boot Basic-auth password for the ax-code runtime.
// It is generated once per app boot and handed to the web-server
// utilityProcess via AX_CODE_SERVER_PASSWORD; the web server adopts it, uses
// it for its proxy Authorization header, and forwards it to the runtime child
// env exactly as before.
//
// Security: never log this value, never persist it to disk, never include it
// in diagnostics or startup events.

// Format matches the web server's standalone generator
// (web/server/lib/ax-code/auth-state-runtime.js): 32 random bytes rendered as
// unpadded base64url (43 chars), so either side stays format-compatible no
// matter which one generated the password.
function generateRuntimeAuthPassword(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

// A provider memoizes exactly one password per process. An inherited
// non-empty AX_CODE_SERVER_PASSWORD (user-exported into the desktop shell)
// takes precedence over generation, preserving the pre-S2.2 behavior where
// the web server adopted that env value as a "user-env" password.
function createRuntimeAuthPasswordProvider({ env = process.env, randomBytes = crypto.randomBytes } = {}) {
  let password = null
  return {
    getPassword() {
      if (password) return password
      const inherited = typeof env.AX_CODE_SERVER_PASSWORD === "string" ? env.AX_CODE_SERVER_PASSWORD.trim() : ""
      password = inherited || generateRuntimeAuthPassword(randomBytes)
      return password
    },
  }
}

// Process-wide provider. S2.4 will reuse this same getter to inject the
// Authorization header in the app:// protocol handler, so the credential
// never leaves the main process.
const defaultProvider = createRuntimeAuthPasswordProvider()
const getRuntimeAuthPassword = () => defaultProvider.getPassword()

module.exports = { createRuntimeAuthPasswordProvider, generateRuntimeAuthPassword, getRuntimeAuthPassword }
