import fs from "node:fs"

// S2.4b (SPEC-2026-08-29-desktop-process-model-collapse §2 D3): dev-only
// publication of the ax-code runtime's current loopback origin + Basic
// credential for the Vite dev proxy. In packaged mode the app:// protocol
// handler gets the origin over the utilityProcess channel and owns the
// credential in main (S2.4a); in dev the Vite process is a separate process
// tree, so the web server — which already knows both — mirrors the same
// information to a small JSON file the Vite proxy plugin re-reads.
//
// Hard rules:
// - Dev only. The writer activates solely when the orchestrator
//   (desktop/packages/electron/scripts/dev.mjs) sets
//   AX_CODE_DESKTOP_DEV_UPSTREAM_FILE; packaged/production runs never set it,
//   so this module stays inert there.
// - The file carries a secret. It is written 0600 via atomic tmp+rename, its
//   contents are never logged, and it is removed whenever the runtime origin
//   goes away (down/restart transitions) and on process exit.
// - The Vite side treats the file as untrusted input: shape-validated safe
//   parse, loopback-origin enforcement, fallback to the web server on any
//   problem (see vite-api-runtime-proxy.ts).

export const DEV_RUNTIME_UPSTREAM_FILE_ENV = "AX_CODE_DESKTOP_DEV_UPSTREAM_FILE"

const normalizeFilePath = (filePath) =>
  typeof filePath === "string" && filePath.trim().length > 0 ? filePath.trim() : null

const buildUpstreamPayload = (origin, getAxCodeAuthHeaders) => {
  const payload = {
    version: 1,
    origin: String(origin).replace(/\/+$/, ""),
    updatedAt: new Date().toISOString(),
  }

  let authHeaders = {}
  try {
    authHeaders = typeof getAxCodeAuthHeaders === "function" ? getAxCodeAuthHeaders() || {} : {}
  } catch {
    authHeaders = {}
  }

  // Shape mirrors the Vite-side Authorization injection:
  // "Basic base64("ax-code:" + password)". External runtimes without a
  // credential simply omit the field; the proxy then forwards unauthenticated,
  // exactly like the packaged handler with no configured password.
  if (typeof authHeaders.Authorization === "string" && authHeaders.Authorization.startsWith("Basic ")) {
    payload.authorization = authHeaders.Authorization
  }

  return payload
}

// Returns { publish(origin), remove(), active }. publish(null) removes the
// file — the runtime is unavailable and the Vite proxy must fall back to the
// web server. All filesystem errors are swallowed (the dev proxy falls back
// to today's behavior when the file is missing); the payload is never logged.
export const createDevRuntimeUpstreamWriter = ({ filePath, getAxCodeAuthHeaders, processRef = process } = {}) => {
  const targetPath = normalizeFilePath(filePath)
  if (!targetPath) {
    return { active: false, publish: () => {}, remove: () => {} }
  }

  const remove = () => {
    try {
      fs.unlinkSync(targetPath)
    } catch {}
  }

  const publish = (origin) => {
    if (typeof origin !== "string" || origin.length === 0) {
      remove()
      return
    }

    const payload = buildUpstreamPayload(origin, getAxCodeAuthHeaders)
    const tmpPath = `${targetPath}.${processRef.pid}.tmp`
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 })
      fs.renameSync(tmpPath, targetPath)
      // rename() preserves the tmp file's mode; chmod anyway in case an older,
      // looser-mode file is being replaced on a filesystem with odd semantics.
      fs.chmodSync(targetPath, 0o600)
    } catch (error) {
      try {
        fs.unlinkSync(tmpPath)
      } catch {}
      // Path and message only — never the payload (it carries the credential).
      console.warn(
        `[dev-runtime-upstream] failed to publish runtime origin to ${targetPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  // Best-effort cleanup on shutdown. Covers graceful exits and SIGTERM-driven
  // shutdowns (nodemon restarts included); SIGKILL leaves a stale file, which
  // the Vite side tolerates by falling back to the web server on proxy errors.
  try {
    processRef.once("exit", remove)
  } catch {}

  return { active: true, publish, remove }
}
