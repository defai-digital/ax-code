"use strict"

// S2.4a (SPEC-2026-08-29-desktop-process-model-collapse §2 D3): longest-prefix
// router for the packaged app:// protocol handler. Every renderer request path
// is classified into exactly one of two backends:
//
//   - "runtime": the ax-code runtime process. The handler rewrites ^/api → ""
//     and forwards directly to the runtime origin, injecting the per-boot
//     Basic Authorization header owned by main (§2 D2).
//   - "web": the existing web server. The path is forwarded verbatim, exactly
//     as before S2.4. The web server still catch-all-proxies unknown /api/*
//     paths to the runtime, so a web classification is always behavior-safe
//     (the double hop simply remains for that path).
//
// The DEFAULT target is "web": an unclassified path keeps working unchanged.
// Every path the renderer actually uses (ui/src/lib/http.ts) has an explicit
// entry; api-prefix-router.test.mjs enforces that coverage.
//
// Runtime prefixes below are derived from the runtime route table
// (packages/ax-code/src/server/server.ts), mapped to their /api-prefixed
// renderer forms. Desktop overrides win over runtime prefixes because they
// are longer (or equally long but fully literal); entries with a `methods`
// constraint only match those HTTP methods, everything else falls through to
// the next matching entry or the safe "web" default.

// Desktop-owned routes that live UNDER runtime-shaped prefixes. These must
// stay on the web server (see web/server/lib/ax-code/routes.js,
// core-routes.js, config-entity-routes.js, skill-routes.js, plugin-routes.js,
// notifications/routes.js).
const DESKTOP_OVERRIDE_ENTRIES = [
  // /api/session/* is runtime, except these two desktop wrappers.
  { path: "/api/session/:sessionId/prompt_async", target: "web" },
  { path: "/api/session/:sessionId/command", target: "web" },
  // /api/provider/* is runtime, except these desktop routes.
  { path: "/api/provider/:providerId/source", target: "web" },
  { path: "/api/provider/:providerId/auth", target: "web", methods: ["DELETE"] },
  // /api/mcp/* is runtime, except the desktop pending-auth store.
  { path: "/api/mcp/auth/pending", target: "web" },
  // /api/config is torn: the bare path and /api/config/providers are runtime;
  // every desktop config-entity CRUD group below stays on the web server.
  { path: "/api/config/settings", target: "web" },
  { path: "/api/config/ax-code-resolution", target: "web" },
  { path: "/api/config/themes", target: "web" },
  { path: "/api/config/reload", target: "web" },
  { path: "/api/config/agents", target: "web" },
  { path: "/api/config/mcp", target: "web" },
  { path: "/api/config/commands", target: "web" },
  { path: "/api/config/snippets", target: "web" },
  { path: "/api/config/plugins", target: "web" },
  { path: "/api/config/skills", target: "web" },
]

// Desktop-owned top-level prefixes. None collide with a runtime prefix; they
// are listed explicitly so renderer-used paths never fall through to the
// silent default (see desktop-owned-routes.js and the S2.4 task contract).
const DESKTOP_PREFIX_ENTRIES = [
  { path: "/api/ax-code", target: "web" },
  { path: "/api/behavior", target: "web" },
  { path: "/api/sessions", target: "web" },
  { path: "/api/session-activity", target: "web" },
  { path: "/api/session-folders", target: "web" },
  { path: "/api/fs", target: "web" },
  { path: "/api/git", target: "web" },
  { path: "/api/github", target: "web" },
  { path: "/api/quota", target: "web" },
  { path: "/api/terminal", target: "web" },
  { path: "/api/notifications", target: "web" },
  { path: "/api/preview", target: "web" },
  { path: "/api/openchamber", target: "web" },
  { path: "/api/zen", target: "web" },
  { path: "/api/projects", target: "web" },
  { path: "/api/magic-prompts", target: "web" },
  { path: "/api/passkeys", target: "web" },
  { path: "/api/system", target: "web" },
  { path: "/api/desktop", target: "web" },
  // /api/auth/* is the desktop UI-password surface; the runtime's
  // PUT /auth/:providerID renderer form is the more specific runtime entry
  // below and wins for PUT only.
  { path: "/api/auth", target: "web" },
  // The runtime has no /health route; /api/health keeps today's web-proxy hop.
  { path: "/api/health", target: "web" },
  // The web server's own health endpoint.
  { path: "/health", target: "web" },
  // UI password/passkey perimeter (non-/api form).
  { path: "/auth", target: "web" },
]

// Runtime route table (packages/ax-code/src/server/server.ts) mapped to the
// /api-prefixed renderer forms the SDK client emits. /global, /graph and
// /dre-graph are reached by the renderer without the /api prefix, so their
// upstream path is forwarded verbatim.
const RUNTIME_PREFIX_ENTRIES = [
  // Runtime PUT /auth/:providerID (server.ts). Method-scoped: any other
  // method under /api/auth/* stays on the desktop UI-auth surface.
  { path: "/api/auth/:providerID", target: "runtime", methods: ["PUT"] },
  // /api/config exact and /api/config/providers are runtime; the desktop
  // overrides above cover the desktop-owned /api/config/* groups.
  { path: "/api/config", target: "runtime" },
  { path: "/api/project", target: "runtime" },
  { path: "/api/pty", target: "runtime" },
  { path: "/api/isolation", target: "runtime" },
  { path: "/api/autonomous", target: "runtime" },
  { path: "/api/smart-llm", target: "runtime" },
  { path: "/api/super-long", target: "runtime" },
  { path: "/api/prompt-history", target: "runtime" },
  { path: "/api/task-queue", target: "runtime" },
  { path: "/api/scheduled-task", target: "runtime" },
  { path: "/api/workflow-runs", target: "runtime" },
  { path: "/api/workflow-templates", target: "runtime" },
  { path: "/api/workflow-routines", target: "runtime" },
  { path: "/api/experimental", target: "runtime" },
  { path: "/api/session", target: "runtime" },
  { path: "/api/permission", target: "runtime" },
  { path: "/api/audit", target: "runtime" },
  { path: "/api/question", target: "runtime" },
  { path: "/api/provider", target: "runtime" },
  // FileRoutes (mounted at "/"): /find, /file.
  { path: "/api/find", target: "runtime" },
  { path: "/api/file", target: "runtime" },
  // EventRoutes (mounted at "/"): /event SSE.
  { path: "/api/event", target: "runtime" },
  { path: "/api/mcp", target: "runtime" },
  { path: "/api/tui", target: "runtime" },
  // AppRoutes (mounted at "/"): /instance, /path, /vcs, /command,
  // /capability, /log, /agent.
  { path: "/api/instance", target: "runtime" },
  { path: "/api/path", target: "runtime" },
  { path: "/api/vcs", target: "runtime" },
  { path: "/api/command", target: "runtime" },
  { path: "/api/capability", target: "runtime" },
  { path: "/api/log", target: "runtime" },
  { path: "/api/agent", target: "runtime" },
  { path: "/api/context", target: "runtime" },
  { path: "/api/skill", target: "runtime" },
  // RuntimeStatusRoutes (mounted at "/"): /lsp, /debug-engine, /formatter.
  { path: "/api/lsp", target: "runtime" },
  { path: "/api/debug-engine", target: "runtime" },
  { path: "/api/formatter", target: "runtime" },
  // GlobalRoutes live at /global on the runtime; the renderer reaches them
  // both bare (/global/health, /global/event) and under the /api SDK base.
  { path: "/api/global", target: "runtime" },
  { path: "/global", target: "runtime" },
  // Dashboard HTML/JSON surfaces (no /api to strip).
  { path: "/graph", target: "runtime" },
  { path: "/dre-graph", target: "runtime" },
]

const toSegments = (path) =>
  String(path || "")
    .split("/")
    .filter(Boolean)

const compileEntry = (entry) => {
  const segments = toSegments(entry.path)
  const literalCount = segments.filter((segment) => !segment.startsWith(":")).length
  return { ...entry, segments, literalCount }
}

// Longest prefix wins; among equal-length patterns the one with more literal
// segments wins (so /api/auth/reset beats /api/auth/:providerID); declaration
// order breaks remaining ties (Array.prototype.sort is stable).
const API_ROUTE_TABLE = [...DESKTOP_OVERRIDE_ENTRIES, ...DESKTOP_PREFIX_ENTRIES, ...RUNTIME_PREFIX_ENTRIES]
  .map(compileEntry)
  .sort((a, b) => b.segments.length - a.segments.length || b.literalCount - a.literalCount)

const matchesEntry = (entry, segments, method) => {
  if (entry.methods && !entry.methods.includes(method)) return false
  if (entry.segments.length > segments.length) return false
  for (let i = 0; i < entry.segments.length; i += 1) {
    const pattern = entry.segments[i]
    if (pattern.startsWith(":")) {
      if (!segments[i]) return false
      continue
    }
    if (pattern !== segments[i]) return false
  }
  return true
}

const stripApiPrefix = (path) => {
  if (path === "/api") return "/"
  if (path.startsWith("/api/")) return path.slice(4)
  return path
}

// Returns the first matching table entry, or null when only the implicit
// "web" default applies. Exported for the route-table coverage test, which
// asserts renderer-used paths never rely on the default.
const matchApiRouteEntry = (pathname, method = "GET") => {
  const normalizedMethod = String(method || "GET").toUpperCase()
  const segments = toSegments(pathname)
  return API_ROUTE_TABLE.find((entry) => matchesEntry(entry, segments, normalizedMethod)) || null
}

// Classify a renderer request path for the packaged protocol handler.
//   target:       "runtime" | "web" (default "web" — safe, see header comment)
//   upstreamPath: ^/api stripped for runtime targets, verbatim otherwise
const routeApiRequest = (pathname, method = "GET") => {
  const path = typeof pathname === "string" && pathname.startsWith("/") ? pathname : `/${pathname || ""}`
  const entry = matchApiRouteEntry(path, method)
  const target = entry?.target ?? "web"
  return {
    target,
    upstreamPath: target === "runtime" ? stripApiPrefix(path) : path,
  }
}

module.exports = {
  API_ROUTE_TABLE,
  matchApiRouteEntry,
  routeApiRequest,
}
