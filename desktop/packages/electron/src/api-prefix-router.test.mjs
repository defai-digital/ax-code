import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

// Renderer endpoint constants, imported straight from the UI package so this
// coverage test cannot drift from the paths the renderer actually fetches.
import { API_ENDPOINTS, API_PATHS } from "../../ui/src/lib/http.ts"

const require = createRequire(import.meta.url)
const { API_ROUTE_TABLE, matchApiRouteEntry, routeApiRequest } = require("./api-prefix-router.js")

describe("api prefix router", () => {
  test("routes runtime-shaped /api prefixes to the runtime with ^/api stripped", () => {
    expect(routeApiRequest("/api/session", "GET")).toEqual({ target: "runtime", upstreamPath: "/session" })
    expect(routeApiRequest("/api/session/abc/todo", "GET")).toEqual({
      target: "runtime",
      upstreamPath: "/session/abc/todo",
    })
    expect(routeApiRequest("/api/config", "GET")).toEqual({ target: "runtime", upstreamPath: "/config" })
    expect(routeApiRequest("/api/config/providers", "GET")).toEqual({
      target: "runtime",
      upstreamPath: "/config/providers",
    })
    expect(routeApiRequest("/api/provider", "GET")).toEqual({ target: "runtime", upstreamPath: "/provider" })
    expect(routeApiRequest("/api/event", "GET")).toEqual({ target: "runtime", upstreamPath: "/event" })
    expect(routeApiRequest("/api/find/file", "GET")).toEqual({ target: "runtime", upstreamPath: "/find/file" })
    expect(routeApiRequest("/api/experimental/tool/ids", "GET")).toEqual({
      target: "runtime",
      upstreamPath: "/experimental/tool/ids",
    })
    expect(routeApiRequest("/api/agent", "GET")).toEqual({ target: "runtime", upstreamPath: "/agent" })
    expect(routeApiRequest("/api/path", "GET")).toEqual({ target: "runtime", upstreamPath: "/path" })
    expect(routeApiRequest("/api/project/current", "GET")).toEqual({
      target: "runtime",
      upstreamPath: "/project/current",
    })
  })

  test("routes bare runtime prefixes without stripping", () => {
    expect(routeApiRequest("/global/health", "GET")).toEqual({ target: "runtime", upstreamPath: "/global/health" })
    expect(routeApiRequest("/global/event", "GET")).toEqual({ target: "runtime", upstreamPath: "/global/event" })
    expect(routeApiRequest("/api/global/event", "GET")).toEqual({ target: "runtime", upstreamPath: "/global/event" })
    expect(routeApiRequest("/graph", "GET")).toEqual({ target: "runtime", upstreamPath: "/graph" })
    expect(routeApiRequest("/dre-graph/view", "GET")).toEqual({ target: "runtime", upstreamPath: "/dre-graph/view" })
  })

  test("desktop overrides win over runtime prefixes (conflict cases)", () => {
    // /api/session/* is runtime, except the two desktop wrappers.
    expect(routeApiRequest("/api/session/abc/prompt_async", "POST")).toEqual({
      target: "web",
      upstreamPath: "/api/session/abc/prompt_async",
    })
    expect(routeApiRequest("/api/session/abc/command", "POST")).toEqual({
      target: "web",
      upstreamPath: "/api/session/abc/command",
    })
    // /api/provider/* is runtime, except the desktop source/auth routes.
    expect(routeApiRequest("/api/provider/anthropic/source", "GET")).toEqual({
      target: "web",
      upstreamPath: "/api/provider/anthropic/source",
    })
    expect(routeApiRequest("/api/provider/anthropic/auth", "DELETE")).toEqual({
      target: "web",
      upstreamPath: "/api/provider/anthropic/auth",
    })
    // Non-DELETE methods on the same path keep the runtime route.
    expect(routeApiRequest("/api/provider/anthropic/auth", "GET")).toEqual({
      target: "runtime",
      upstreamPath: "/provider/anthropic/auth",
    })
    // /api/mcp/* is runtime, except the desktop pending-auth store.
    expect(routeApiRequest("/api/mcp/auth/pending", "POST")).toEqual({
      target: "web",
      upstreamPath: "/api/mcp/auth/pending",
    })
    expect(routeApiRequest("/api/mcp", "GET")).toEqual({ target: "runtime", upstreamPath: "/mcp" })
    // /api/config desktop groups stay on the web server.
    expect(routeApiRequest("/api/config/settings", "PUT")).toEqual({
      target: "web",
      upstreamPath: "/api/config/settings",
    })
    expect(routeApiRequest("/api/config/agents/build", "GET")).toEqual({
      target: "web",
      upstreamPath: "/api/config/agents/build",
    })
    expect(routeApiRequest("/api/config/mcp", "GET")).toEqual({ target: "web", upstreamPath: "/api/config/mcp" })
    // /api/ax-code/* is desktop-only; the runtime has no such prefix.
    expect(routeApiRequest("/api/ax-code/upgrade", "POST")).toEqual({
      target: "web",
      upstreamPath: "/api/ax-code/upgrade",
    })
    expect(routeApiRequest("/api/ax-code/directory", "POST")).toEqual({
      target: "web",
      upstreamPath: "/api/ax-code/directory",
    })
  })

  test("auth split: PUT /api/auth/:providerID is runtime, the rest of /auth stays web", () => {
    expect(routeApiRequest("/api/auth/anthropic", "PUT")).toEqual({
      target: "runtime",
      upstreamPath: "/auth/anthropic",
    })
    expect(routeApiRequest("/api/auth/anthropic", "GET")).toEqual({
      target: "web",
      upstreamPath: "/api/auth/anthropic",
    })
    expect(routeApiRequest("/api/auth/reset", "POST")).toEqual({ target: "web", upstreamPath: "/api/auth/reset" })
    // Deferred (S2.4 review finding #9): DELETE /api/auth/:id stays on the web
    // surface, so a runtime-credential delete double-hops (main → web →
    // runtime). Pinned as expected for now; the web proxy forwards it correctly.
    expect(routeApiRequest("/api/auth/anthropic", "DELETE")).toEqual({
      target: "web",
      upstreamPath: "/api/auth/anthropic",
    })
    expect(routeApiRequest("/auth/session", "GET")).toEqual({ target: "web", upstreamPath: "/auth/session" })
    expect(routeApiRequest("/auth/passkey/status", "GET")).toEqual({
      target: "web",
      upstreamPath: "/auth/passkey/status",
    })
  })

  test("desktop-owned prefixes and health stay on the web server", () => {
    for (const path of [
      "/api/fs/read",
      "/api/git/status",
      "/api/github/me",
      "/api/quota/anthropic",
      "/api/terminal/list",
      "/api/notifications/stream",
      "/api/preview/targets",
      "/api/openchamber/events",
      "/api/zen/models",
      "/api/projects",
      "/api/magic-prompts",
      "/api/session-folders",
      "/api/passkeys",
      "/api/system/info",
      "/api/desktop/diagnostics/startup",
      "/api/behavior/agents-md",
      "/api/sessions",
      "/api/session-activity",
      "/api/health",
      "/health",
    ]) {
      expect(routeApiRequest(path, "GET")).toEqual({ target: "web", upstreamPath: path })
    }
  })

  test("unknown paths fall back to the safe web default verbatim", () => {
    expect(routeApiRequest("/api/totally-unknown", "GET")).toEqual({
      target: "web",
      upstreamPath: "/api/totally-unknown",
    })
    expect(matchApiRouteEntry("/api/totally-unknown", "GET")).toBeNull()
  })

  test("prefix matching respects segment boundaries", () => {
    // /api/session (runtime) must not swallow /api/sessions or
    // /api/session-activity (desktop), and /api/project must not swallow
    // /api/projects.
    expect(routeApiRequest("/api/sessions", "GET").target).toBe("web")
    expect(routeApiRequest("/api/session-activity", "GET").target).toBe("web")
    expect(routeApiRequest("/api/session-folders", "GET").target).toBe("web")
    expect(routeApiRequest("/api/projects", "GET").target).toBe("web")
    expect(routeApiRequest("/api/project/current", "GET").target).toBe("runtime")
    // /api/file (runtime) must not swallow /api/fs (desktop).
    expect(routeApiRequest("/api/fs/read", "GET").target).toBe("web")
    expect(routeApiRequest("/api/file/status", "GET").target).toBe("runtime")
  })
})

// ── Renderer route-table coverage ───────────────────────────────────────────
// Every path in ui/src/lib/http.ts API_PATHS/API_ENDPOINTS must have an
// explicit classification in API_ROUTE_TABLE — no silent defaults for paths
// the renderer actually fetches. RUNTIME_ENDPOINTS lists the leaves expected
// to classify as "runtime"; everything else must classify as "web".
const RUNTIME_ENDPOINTS = new Set([
  "API_PATHS.config",
  "API_ENDPOINTS.config.base",
  "API_ENDPOINTS.debug.globalHealth",
  "API_ENDPOINTS.debug.path",
  "API_ENDPOINTS.debug.projectCurrent",
  "API_ENDPOINTS.debug.project",
  "API_ENDPOINTS.debug.config",
  "API_ENDPOINTS.debug.configProviders",
  "API_ENDPOINTS.debug.agent",
  "API_ENDPOINTS.debug.command",
  "API_ENDPOINTS.debug.session",
  "API_ENDPOINTS.debug.sessionStatus",
  "API_ENDPOINTS.find.file",
  "API_ENDPOINTS.provider.base",
  "API_ENDPOINTS.provider.auth",
  "API_ENDPOINTS.provider.custom",
  "API_ENDPOINTS.provider.customByProvider",
  "API_ENDPOINTS.provider.axEngineModels",
  "API_ENDPOINTS.provider.axEngineModelDownload",
  "API_ENDPOINTS.provider.axEngineDownloads",
  "API_ENDPOINTS.provider.axEngineDownloadCancel",
  "API_ENDPOINTS.provider.axEngineModel",
  "API_ENDPOINTS.provider.axEngineConnection",
  "API_ENDPOINTS.provider.axEngineStart",
  "API_ENDPOINTS.provider.axEngineStop",
  "API_ENDPOINTS.provider.axEngineInstall",
  "API_ENDPOINTS.provider.alibabaPaiConnection",
  "API_ENDPOINTS.provider.privateGpuConnection",
  "API_ENDPOINTS.provider.authByProvider",
  "API_ENDPOINTS.provider.oauthAuthorize",
  "API_ENDPOINTS.provider.oauthCallback",
  "API_ENDPOINTS.session.todo",
  "API_ENDPOINTS.session.status",
  "API_ENDPOINTS.session.promptForSession",
  "API_ENDPOINTS.tools.ids",
])

// Method-sensitive leaves: the runtime route only exists for these methods.
const ENDPOINT_METHODS = {
  "API_ENDPOINTS.provider.authByProvider": "PUT",
  "API_ENDPOINTS.provider.authAll": "DELETE",
  "API_ENDPOINTS.session.promptAsyncForSession": "POST",
  "API_ENDPOINTS.session.commandForSession": "POST",
  "API_ENDPOINTS.axCode.upgrade": "POST",
  "API_ENDPOINTS.session.directory": "POST",
}

const flattenEndpoints = (value, prefix, out = {}) => {
  for (const [key, entry] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (typeof entry === "string") {
      out[name] = entry
    } else if (entry && typeof entry === "object") {
      flattenEndpoints(entry, name, out)
    }
  }
  return out
}

describe("renderer route-table coverage (ui/src/lib/http.ts)", () => {
  const leaves = {
    ...flattenEndpoints(API_PATHS, "API_PATHS"),
    ...flattenEndpoints(API_ENDPOINTS, "API_ENDPOINTS"),
  }

  test("every renderer endpoint constant has an explicit classification", () => {
    const failures = []
    for (const [name, template] of Object.entries(leaves)) {
      const path = template.replace(/:[A-Za-z]+/g, "sample")
      const method = ENDPOINT_METHODS[name] ?? "GET"
      const expected = RUNTIME_ENDPOINTS.has(name) ? "runtime" : "web"
      const route = routeApiRequest(path, method)
      // API_PATHS.base ("/api") is a URL base, not a fetched path — it is the
      // one constant allowed to rely on the implicit web default.
      const entry = matchApiRouteEntry(path, method)
      if (name !== "API_PATHS.base" && !entry) {
        failures.push(`${name} (${method} ${path}) fell through to the implicit default`)
        continue
      }
      if (route.target !== expected) {
        failures.push(`${name} (${method} ${path}) routed to ${route.target}, expected ${expected}`)
      }
    }
    expect(failures).toEqual([])
  })

  test("runtime-classified endpoints strip ^/api for the upstream path", () => {
    for (const name of RUNTIME_ENDPOINTS) {
      const template = leaves[name]
      if (!template || !template.startsWith("/api/")) continue
      const path = template.replace(/:[A-Za-z]+/g, "sample")
      const method = ENDPOINT_METHODS[name] ?? "GET"
      const route = routeApiRequest(path, method)
      expect(route.upstreamPath).toBe(path.slice(4))
    }
  })

  test("the route table has no duplicate or shadowed literal entries", () => {
    const seen = new Set()
    for (const entry of API_ROUTE_TABLE) {
      const key = `${entry.target}:${entry.path}:${(entry.methods ?? []).join(",")}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })
})
