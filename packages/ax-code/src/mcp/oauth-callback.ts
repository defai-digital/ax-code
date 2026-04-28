import { Log } from "../util/log"
import { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH, setCallbackPort } from "./oauth-provider"

const log = Log.create({ service: "mcp.oauth-callback" })

const HTML_SUCCESS = `<!DOCTYPE html>
<html>
<head>
  <title>ax-code - Authorization Successful</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #4ade80; margin-bottom: 1rem; }
    p { color: #aaa; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Successful</h1>
    <p>You can close this window and return to ax-code.</p>
  </div>
  <script>setTimeout(() => window.close(), 2000);</script>
</body>
</html>`

function escape(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const HTML_ERROR = (error: string) => `<!DOCTYPE html>
<html>
<head>
  <title>ax-code - Authorization Failed</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #1a1a2e; color: #eee; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #f87171; margin-bottom: 1rem; }
    p { color: #aaa; }
    .error { color: #fca5a5; font-family: monospace; margin-top: 1rem; padding: 1rem; background: rgba(248,113,113,0.1); border-radius: 0.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Authorization Failed</h1>
    <p>An error occurred during authorization.</p>
    <div class="error">${escape(error)}</div>
  </div>
</body>
</html>`

interface PendingAuth {
  resolve: (code: string) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export namespace McpOAuthCallback {
  let server: ReturnType<typeof Bun.serve> | undefined
  // In-flight init promise. Serializes concurrent ensureRunning() calls so
  // two callers never race past the `if (server)` guard and both attempt
  // `Bun.serve()` on the same port (EADDRINUSE). Cleared on completion so
  // a subsequent start after stop() can still initialize.
  let initPromise: Promise<void> | undefined
  const pendingAuths = new Map<string, PendingAuth>()
  const pendingStates = new Map<string, string>()

  const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
  // Defense-in-depth cap. The 5-minute timeout is the primary cleanup path
  // — every entry self-evicts after that — but a script that rapid-fires
  // `startAuth` for hundreds of servers would otherwise grow this Map
  // unboundedly within the timeout window. When the cap is reached we
  // reject the oldest pending wait so the caller sees a deterministic
  // error instead of a silent stall.
  const PENDING_AUTHS_MAX = 100

  function evictOldestPendingAuth() {
    const oldest = pendingAuths.keys().next().value
    if (oldest === undefined) return
    const entry = pendingAuths.get(oldest)
    if (!entry) return
    clearTimeout(entry.timeout)
    pendingAuths.delete(oldest)
    for (const [name, value] of pendingStates) {
      if (value === oldest) {
        pendingStates.delete(name)
        break
      }
    }
    log.warn("evicting oldest pending oauth callback — pendingAuths cap reached", {
      cap: PENDING_AUTHS_MAX,
      evictedState: oldest,
    })
    entry.reject(new Error("OAuth callback evicted: too many concurrent in-flight flows"))
  }

  export async function ensureRunning(): Promise<void> {
    if (server) return
    if (initPromise) return initPromise
    initPromise = (async () => {
      server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req) {
          const url = new URL(req.url)

          if (url.pathname !== OAUTH_CALLBACK_PATH) {
            return new Response("Not found", { status: 404 })
          }

          const code = url.searchParams.get("code")
          const state = url.searchParams.get("state")
          const error = url.searchParams.get("error")
          const errorDescription = url.searchParams.get("error_description")

          log.info("received oauth callback", { hasCode: !!code, state, error })

          // Enforce state parameter presence
          if (!state) {
            const errorMsg = "Missing required state parameter - potential CSRF attack"
            log.error("oauth callback missing state parameter", { url: url.toString() })
            return new Response(HTML_ERROR(errorMsg), {
              status: 400,
              headers: { "Content-Type": "text/html" },
            })
          }

          if (error) {
            const errorMsg = errorDescription || error
            if (pendingAuths.has(state)) {
              const pending = pendingAuths.get(state)!
              clearTimeout(pending.timeout)
              pendingAuths.delete(state)
              for (const [name, value] of pendingStates) {
                if (value === state) pendingStates.delete(name)
              }
              pending.reject(new Error(errorMsg))
            }
            return new Response(HTML_ERROR(errorMsg), {
              headers: { "Content-Type": "text/html" },
            })
          }

          if (!code) {
            return new Response(HTML_ERROR("No authorization code provided"), {
              status: 400,
              headers: { "Content-Type": "text/html" },
            })
          }

          // Validate state parameter
          if (!pendingAuths.has(state)) {
            const errorMsg = "Invalid or expired state parameter - potential CSRF attack"
            log.error("oauth callback with invalid state", { state, pending: pendingAuths.size })
            return new Response(HTML_ERROR(errorMsg), {
              status: 400,
              headers: { "Content-Type": "text/html" },
            })
          }

          const pending = pendingAuths.get(state)!

          clearTimeout(pending.timeout)
          pendingAuths.delete(state)
          for (const [name, value] of pendingStates) {
            if (value === state) pendingStates.delete(name)
          }
          pending.resolve(code)

          return new Response(HTML_SUCCESS, {
            headers: { "Content-Type": "text/html" },
          })
        },
      })

      const boundPort = server.port ?? OAUTH_CALLBACK_PORT
      setCallbackPort(boundPort)
      log.info("oauth callback server started", { port: boundPort })
    })().finally(() => {
      initPromise = undefined
    })
    return initPromise
  }

  export function waitForCallback(oauthState: string, mcpName?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const previous = pendingAuths.get(oauthState)
      if (previous) {
        clearTimeout(previous.timeout)
        previous.reject(new Error("OAuth callback request superseded"))
      }

      // Bound the in-flight set so a runaway caller can't leak memory
      // for a full 5-minute timeout window. We only evict if we're
      // about to grow past the cap — re-registering an existing state
      // (the `previous` branch above) doesn't increase Map size.
      if (!pendingAuths.has(oauthState) && pendingAuths.size >= PENDING_AUTHS_MAX) {
        evictOldestPendingAuth()
      }

      if (mcpName) pendingStates.set(mcpName, oauthState)
      const timeout = setTimeout(() => {
        const current = pendingAuths.get(oauthState)
        if (current?.timeout === timeout) {
          pendingAuths.delete(oauthState)
          if (mcpName) pendingStates.delete(mcpName)
          reject(new Error("OAuth callback timeout - authorization took too long"))
        }
      }, CALLBACK_TIMEOUT_MS)

      pendingAuths.set(oauthState, { resolve, reject, timeout })
    })
  }

  export function cancelPending(mcpName: string): void {
    const oauthState = pendingStates.get(mcpName)
    if (!oauthState) return
    const pending = pendingAuths.get(oauthState)
    if (pending) {
      clearTimeout(pending.timeout)
      pendingAuths.delete(oauthState)
      pendingStates.delete(mcpName)
      pending.reject(new Error("Authorization cancelled"))
    }
  }

  export async function isPortInUse(): Promise<boolean> {
    return isRunning()
  }

  export async function stop(): Promise<void> {
    if (server) {
      server.stop()
      server = undefined
      log.info("oauth callback server stopped")
    }

    for (const [name, pending] of pendingAuths) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("OAuth callback server stopped"))
    }
    pendingAuths.clear()
    pendingStates.clear()
  }

  export function isRunning(): boolean {
    return server !== undefined
  }
}
