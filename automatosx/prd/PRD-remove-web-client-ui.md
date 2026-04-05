# Product Requirements Document (PRD)

# AX Code — Remove Web Client UI

**Document Version:** 0.1 — Draft
**Date:** 2026-04-05
**Status:** Draft — Pending review
**Author:** automatosx
**Related release:** post-v2.3.0
**Feature flag:** none required (removal, not a new feature)

---

## References (codebase, verified)

- `packages/app/` — SolidJS web app, 604 files / ~48.6k LOC, 19 top-level dirs
- `packages/desktop/` — Tauri wrapper that imports `@ax-code/app` as a workspace dep
- `packages/ax-code/src/server/server.ts:1102-1117` — catch-all `.all("/*")` that proxies every non-API path to `https://app.ax-code.ai` and stamps a CSP header
- `packages/ax-code/src/server/server.ts:472-497` — CORS allow-list, including `*.ax-code.ai` / `*.opencode.ai` and Tauri origins
- `packages/ax-code/src/server/server.ts:450-453` — shared basic-auth middleware (not web-specific)
- `packages/ax-code/src/cli/cmd/runtime/web.ts` — `WebCommand` ("start ax-code server and open web interface")
- `packages/ax-code/src/cli/cmd/web.ts` — thin re-export of `WebCommand`
- `packages/ax-code/src/cli/boot.ts:34`, `packages/ax-code/src/cli/boot.ts:61` — `WebCommand` import + registration in the yargs command table
- `packages/ax-code/ARCHITECTURE.md:10` — *"must not depend on `@ax-code/app`, `@ax-code/desktop`, or `@ax-code/ui`"* (and same constraint in `packages/sdk/js/ARCHITECTURE.md:10`, `packages/plugin/ARCHITECTURE.md:10`, `packages/util/ARCHITECTURE.md:10`)
- `packages/desktop/src-tauri/tauri.conf.json` — `frontendDist: "../dist"`, `devUrl: "http://localhost:1420"` (bundled, not remote)
- `packages/desktop/src/index.tsx:16` — `import { ... } from "@ax-code/app"` (only live reverse-dependency on `packages/app`)
- `packages/ui/src/components/todo-panel-motion.stories.tsx:19` — doc-string reference to `packages/app/src/pages/session/composer/session-composer-region.tsx` (cosmetic)
- `.github/workflows/publish.yml` — publishes CLI binaries only; does **not** build `packages/app` or `packages/desktop`
- `packages/ax-code/script/build.ts` — CLI build script; does **not** reference `packages/app`
- `README.md:75-79` — runtime architecture diagram (already updated this release) + source link
- `docs/adr/ADR-004-ax-code-positioning.md` — positions "multi-surface runtime (CLI + SDK + server + desktop + web)"

---

## 0. TL;DR

Remove the ax-code web client UI and everything it pulls in.

**Why:** Users report they don't use it. The current implementation proxies every non-API request from the local server to `https://app.ax-code.ai`, which (a) creates a silent dependency on a remote host for a product marketed as local-first, (b) is the source of the recent `UnknownError: Unable to connect` reports when that host or a user's firewall blocks it, and (c) broadens the attack surface of a runtime whose core promise is *control, auditability, and sandboxed execution*.

**What goes away:**

1. `packages/app/` — the entire SolidJS web app (~48.6k LOC, 604 files)
2. `packages/desktop/` — the Tauri wrapper (its only purpose is to embed `packages/app`)
3. The `ax-code web` CLI command
4. The server's catch-all proxy route to `app.ax-code.ai`
5. CORS allow-list entries for `*.ax-code.ai`, `*.opencode.ai`, and `tauri://*`
6. Docs/README references that position the web UI as a first-class surface

**What stays, unchanged:**

- The entire `ax-code serve` headless HTTP/JSON API — all existing routes, auth, CORS for `localhost`, everything consumed by the SDK and TUI
- The TUI (`ax-code` / `ax-code run`)
- The JS SDK (`packages/sdk/js`)
- The plugin system (`packages/plugin`)
- The `@ax-code/ui` component library (kept for Storybook/TUI development, with one doc-string cleanup)
- MCP server mode, LSP, Code Intelligence, the Debugging & Refactoring Engine, and every other v2.x subsystem — none of these depend on the web UI

**Why this is a low-risk change:** The monorepo's own `ARCHITECTURE.md` files already declare that `ax-code`, `sdk/js`, `plugin`, and `util` **must not** depend on `@ax-code/app` or `@ax-code/desktop`. The web UI has always been a *leaf* of the dependency graph. Removing a leaf cannot break the trunk.

The strategic framing:

> ax-code is a runtime for **controlled execution**. A silent remote proxy to a hosted web bundle is the exact opposite of controlled execution. Removing it is a positioning correction, not a feature loss.

---

## 1. Context

### 1.1 What the web client does today

There are two physical surfaces and one logical product:

1. **`packages/app`** — a 604-file SolidJS single-page app. Its workspace dependencies are `@ax-code/sdk`, `@ax-code/ui`, `@ax-code/util`, and `ghostty-web`. It talks to the ax-code server via the same HTTP/JSON API the SDK uses.
2. **`packages/desktop`** — a Tauri shell that bundles `packages/app`'s built output (`frontendDist: "../dist"`) and ships as a native binary. Its only live import is `import { ... } from "@ax-code/app"` at `packages/desktop/src/index.tsx:16`.
3. **The `ax-code web` command** (`packages/ax-code/src/cli/cmd/runtime/web.ts`) — starts the Hono server, then opens `http://localhost:<port>` in a browser. Because the local server does **not** serve the app assets, the request flows through the server's catch-all route, which proxies to `https://app.ax-code.ai`. In other words: "local" web access today is actually a round-trip to a remote host.

### 1.2 What we observed in the audit

A 60-minute code audit (see §Appendix A) turned up the following facts that shape this PRD:

| # | Finding | Source | Implication |
|---|---|---|---|
| 1 | **Zero reverse-deps on `@ax-code/app` from core packages.** Only `packages/desktop` imports it. | Grep across `packages/ax-code`, `packages/sdk`, `packages/plugin`, `packages/ui`, `packages/util` | Removing `packages/app` cannot break the CLI, SDK, or server at link time. |
| 2 | **The architectural constraint is already written down.** | `packages/ax-code/ARCHITECTURE.md:10`, plus three sibling files | This PRD is *enforcing an invariant that already exists* — not breaking a convention. |
| 3 | **The `ax-code web` command's entire runtime depends on `app.ax-code.ai` being reachable.** | `packages/ax-code/src/server/server.ts:1105` | Every `ax-code web` invocation today is a round-trip to a remote host. This is the root cause of the `UnknownError: Unable to connect` report. |
| 4 | **All API routes (`/session`, `/project`, `/mcp`, `/file`, `/config`, `/experimental`, `/provider`, `/event`, `/question`, `/permission`, `/audit`, `/global`, `/auth`) are shared with the TUI and SDK.** No route exists *only* for the browser. | `packages/ax-code/src/server/server.ts:498-1101` | Removing the web UI does **not** shrink the API surface. `ax-code serve` keeps working identically. |
| 5 | **No test coverage** for the `web` command, the proxy route, or browser-only flows. | `packages/ax-code/test/` survey | Removing this code removes zero tests. No regression risk in CI. |
| 6 | **Neither `packages/app` nor `packages/desktop` is in the release pipeline.** | `.github/workflows/publish.yml`, `packages/ax-code/script/build.ts` | The web UI is not shipped to end-users as an artifact. Removal does not break any published asset. |
| 7 | **The CSP header is applied only to proxied responses**, not to the API. | `packages/ax-code/src/server/server.ts:1112-1114` | The CSP only exists to protect the browser bundle. Removing the proxy removes the need for the CSP. |
| 8 | **CORS allows both `*.ax-code.ai` AND `*.opencode.ai`.** | `packages/ax-code/src/server/server.ts:487` | Legacy/alternative branding. Both get removed. |
| 9 | **Tauri origins in CORS will become dead entries** once desktop is gone. | `packages/ax-code/src/server/server.ts:480-484` | Remove in the same diff. |

### 1.3 Security framing

The user specifically flagged **security bug worry**. The current web-proxy design has several properties that make this worry legitimate, independent of whether an actual CVE exists today:

- **Silent outbound HTTPS.** Starting the local server opens no outbound connections; running `ax-code web` opens a connection to a remote host on the first page load. A user running ax-code in a "local-only" mental model is not expecting this.
- **Remote-controlled JavaScript execution.** The HTML/JS served by the browser originates from `app.ax-code.ai`, not from the local binary. A compromise or misconfiguration of that host would be able to execute arbitrary JS against a user's locally-authenticated ax-code server. The CSP at `server.ts:1113` mitigates some classes of abuse (no `unsafe-eval`, no cross-origin scripts) but does not eliminate the threat model — the trusted origin is, by construction, a host the user does not control.
- **CORS allow-list for remote domains.** `^https://([a-z0-9-]+\.)*(ax-code|opencode)\.ai$` means any subdomain of two registrable domains can make authenticated cross-origin calls against the local ax-code server. This is a standing grant to a surface the user doesn't audit.
- **Supply chain.** `packages/app` pulls in a sizable SolidJS + Kobalte + Shiki + remeda dependency tree that the core CLI never touches. Dropping it reduces the transitive dependency surface of the repo even if the CLI binary never bundled it.

None of this is "a bug" in the narrow sense. Collectively, it is a threat model ax-code **should not have** given its positioning.

---

## 2. Goals & non-goals

### 2.1 Goals

1. **Delete `packages/app` and `packages/desktop` from the monorepo** in a single atomic change, including their `package.json` entries, build scripts, and any workspace references.
2. **Remove the `ax-code web` command** and its registration in the CLI boot table.
3. **Remove the catch-all proxy route** and associated CSP header from `server.ts`.
4. **Tighten the CORS allow-list** to `localhost` and `127.0.0.1` only, removing `*.ax-code.ai`, `*.opencode.ai`, and `tauri://*` entries. The `opts.cors` escape hatch stays for users who need a custom allow-list.
5. **Update docs and the README** so the runtime architecture no longer lists "Web" as a first-class interface. The runtime diagram (`docs/ax-code-runtime.mmd`) already shows `SDK · Server · ACP` and `Web · Desktop · VS Code` in the Interfaces band — both get collapsed to `SDK · Server · ACP` and `VS Code`.
6. **Preserve 100% of `ax-code serve` functionality.** The JSON API, basic-auth, session routes, MCP routes, permission prompts, and every other server-side subsystem behave identically.
7. **Preserve the JS SDK** (`packages/sdk/js`). It was designed to be the programmatic entrypoint; this change makes it the *only* programmatic entrypoint.
8. **Ship a migration note** in the release notes: users who had `ax-code web` in a workflow should switch to `ax-code` (TUI) or the SDK.

### 2.2 Non-goals

- **Not** removing or reshaping the HTTP API. Route paths, payloads, and semantics stay identical.
- **Not** removing basic-auth or the `AX_CODE_SERVER_PASSWORD` env var. Those protect the API regardless of client type.
- **Not** removing the VS Code integration (`packages/integration-vscode/`). It talks to the server via the same JSON API as the SDK.
- **Not** removing `@ax-code/ui`. It is still useful for Storybook and may be reused by future TUI experiments. It has no dependency on `packages/app`.
- **Not** changing the Code Intelligence Runtime, Debugging & Refactoring Engine, LSP, or any other subsystem shipped in v2.1 → v2.3.
- **Not** deprecating-before-removing. The web UI is already broken (the `UnknownError` report) and has no known active users. A deprecation period would preserve a broken surface for no benefit. See §5 for the rollback plan if this turns out to be wrong.

---

## 3. User impact

| User group | Impact | Mitigation |
|---|---|---|
| **CLI / TUI users** (primary) | None. `ax-code` and `ax-code serve` behave identically. | — |
| **SDK users** (primary) | None. All API routes stay. | — |
| **`ax-code web` users** | Command is gone. | Release notes direct them to TUI or SDK. Given the current broken state, we expect zero active users. |
| **Desktop app users** | Desktop package is gone. | No public release ever shipped (confirmed via `publish.yml`). Zero impact. |
| **VS Code extension users** | None. The extension talks to the server, not the web UI. | — |
| **Plugin authors** | None. Plugins target the tool registry, not the UI. | — |

The user groups named "primary" in the README (advanced developers, platform teams, AI-native engineering teams) chose ax-code because it is a controlled execution runtime. None of them picked it for the web UI.

---

## 4. Technical plan

The removal is a single PR. It is large in line count (almost entirely `packages/app` deletions) but small in conceptual scope.

### 4.1 File-level changes

**Delete:**
- `packages/app/` — entire directory
- `packages/desktop/` — entire directory

**Edit `packages/ax-code/src/server/server.ts`:**
- Delete lines 1102-1117 (the `.all("/*")` catch-all proxy and CSP header)
- Delete lines 480-489 of the CORS allow-list (`tauri://*` origins and the `*.ax-code.ai|opencode.ai` regex). Keep `http://localhost:` and `http://127.0.0.1:` entries.
- Delete the `proxy` import from `hono/proxy` at the top of the file (now unused)

**Edit `packages/ax-code/src/cli/boot.ts`:**
- Delete line 34: `import { WebCommand } from "./cmd/web"`
- Delete line 61: `WebCommand,` registration

**Delete:**
- `packages/ax-code/src/cli/cmd/web.ts` (the re-export)
- `packages/ax-code/src/cli/cmd/runtime/web.ts` (the command impl)

**Edit `packages/ui/src/components/todo-panel-motion.stories.tsx:19`:**
- Remove the `packages/app/...` path reference in the story's doc string. Cosmetic, so the file doesn't ship a dangling reference.

**Edit `pnpm-workspace.yaml`:**
- If it uses explicit entries, remove `packages/app` and `packages/desktop`. If it uses `packages/*` (current), no change needed — the deleted dirs simply drop out.

**Edit root `package.json`:**
- Delete `dev:web` and `dev:desktop` convenience scripts if present.

**Edit `README.md`:**
- Line 75-79: update the runtime diagram's referenced mermaid file (already done this release — no change needed, but verify after the diagram is regenerated)
- Adjust any bullets that name "Web / Desktop" as a first-class interface
- Remove any mentions of `ax-code web` as a supported command
- **Regenerate** `docs/images/ax-code-runtime.png` from the updated `.mmd` source

**Edit `docs/ax-code-runtime.mmd`:**
- Change the Interfaces band from `CLI · TUI` / `SDK · Server · ACP` / `Web · Desktop · VS Code` to `CLI · TUI` / `SDK · Server · ACP` / `VS Code`

**Edit `docs/adr/ADR-004-ax-code-positioning.md`:**
- Update the positioning language that lists "CLI + SDK + server + desktop + web" as differentiators. New framing: "CLI + TUI + SDK + server + ACP + LSP + code graph".

### 4.2 What stays untouched

- `packages/ax-code/src/server/routes/` — every file in here
- `packages/sdk/js/` — entire package
- `packages/plugin/`, `packages/ui/`, `packages/util/` — entire packages
- All tests
- All agents, tools, LSP code, Code Intelligence, Debug Engine
- The `serve` command

### 4.3 Auth / CORS posture after removal

| Concern | Before | After |
|---|---|---|
| CORS allow-list | localhost + 127.0.0.1 + `tauri://*` + `*.ax-code.ai` + `*.opencode.ai` + `opts.cors` | localhost + 127.0.0.1 + `opts.cors` |
| Basic-auth | Applied to all routes if `AX_CODE_SERVER_PASSWORD` set | Unchanged |
| Catch-all route | Proxies to `https://app.ax-code.ai` with CSP | **Returns 404** (Hono default) |
| Outbound network calls on `ax-code serve` / `ax-code` start | Zero, then one per browser page load via `ax-code web` | **Zero, period** |

The "outbound network calls: zero, period" property is the security headline. It is also defensible in a one-line release note.

### 4.4 Migration guidance

Add a short section to the v2.4.0 release notes (or whatever the next version is):

> **`ax-code web` and the bundled web UI are removed.** The web client was a thin proxy to a remote host and saw negligible usage. For interactive use, run `ax-code` (TUI). For programmatic use, use the JS SDK (`@ax-code/sdk`) or `ax-code serve`'s HTTP API directly. See `packages/sdk/js/README.md` for examples.

---

## 5. Rollback plan

If, against expectations, a user group surfaces that depended on `ax-code web`:

1. The deletion is a single squash-merge commit; `git revert <sha>` restores everything.
2. Because the CLI API surface doesn't shrink (no routes removed, no flags removed except `web`), consumers of the server and SDK experience zero churn. There is no migration to undo.
3. The only irreversible consequence is if contributors land new PRs on top of the removed code — unlikely given that `packages/app` and `packages/desktop` are already dependency-frozen (`ARCHITECTURE.md` forbids anyone from importing them).

Because the rollback is cheap, the PRD argues **against** a deprecation period. Preserving a broken surface that nobody uses, purely out of process caution, is a worse outcome than removing it and reverting if we're wrong.

---

## 6. Open questions & review asks

1. **Is there a published desktop build anywhere** — Homebrew cask, Tauri release, internal DMG — that we should notify before deletion? The audit says no (`publish.yml` doesn't build desktop), but the owner should confirm.
2. **Is `packages/integration-vscode/ax-code-1.4.0.vsix`** (currently shown as untracked in git status) **coupled to any web-UI code path?** Expected answer: no — it targets the HTTP API. Worth a quick grep before merging.
3. **`AX_CODE_CLIENT` flag.** The flag gates tools on client type (`"cli" | "app" | "desktop"`). After removal, the `"app"` and `"desktop"` values are dead. Decision: leave the enum as-is for one release (harmless), remove in the release after. Or: remove now as part of this PR. Author recommendation: **remove now**, since the flag values would be dead immediately and keeping them is future-archeology debt.
4. **ACP agent.** `packages/ax-code/src/acp/` exposes the server over the Agent Client Protocol. Confirm the ACP session layer is not a browser-client abstraction in disguise. Expected answer: no — ACP is used by CLI-style clients like Zed. Worth verifying during review.
5. **Do we want to also retire the `opencode.ai` CORS regex** as a standalone micro-PR first, to make the web removal PR smaller and more reviewable? The author's preference is to fold it into the single removal PR, but splitting is viable.

---

## 7. Success criteria

- `bun test` passes in `packages/ax-code` with zero test deletions attributable to this change
- `bun typecheck` passes across all remaining packages (`ax-code`, `sdk/js`, `plugin`, `ui`, `util`, `script`)
- `pnpm -r typecheck` passes
- `ax-code --help` does not list `web` as a command
- `ax-code serve --port 4096` starts and responds to `curl http://localhost:4096/session` (or any existing API route) with the same response as before the change
- `rg -n "@ax-code/app|@ax-code/desktop|app\.ax-code\.ai|app\.opencode\.ai" packages/` returns zero matches outside of deleted files
- The regenerated `docs/images/ax-code-runtime.png` matches the new diagram

---

## 8. Appendix A — audit evidence summary

| Category | Evidence |
|---|---|
| `packages/app` size | 604 files, ~48,613 LOC across `src/**/*.{ts,tsx}` |
| `packages/app` workspace deps | `@ax-code/sdk`, `@ax-code/ui`, `@ax-code/util`, `ghostty-web` |
| `packages/app` reverse-deps | Only `packages/desktop/src/index.tsx:16` |
| `packages/desktop` Tauri config | `frontendDist: "../dist"`, `devUrl: "http://localhost:1420"` — embeds app, does not proxy |
| Web-only server code | `server.ts:1102-1117` (proxy + CSP), `server.ts:480-489` (CORS entries) |
| CLI command | `cli/cmd/runtime/web.ts` (49 LOC), `cli/cmd/web.ts` re-export, `cli/boot.ts:34,61` registration |
| Tests touching web UI | Zero |
| CI jobs building web/desktop | Zero |
| Docs mentioning web UI | `docs/adr/ADR-004-ax-code-positioning.md` positioning language; `README.md` runtime bullets; `docs/ax-code-runtime.mmd` Interfaces band |

---

## 9. Suggestion to the reviewer (author's note)

The audit's strongest finding is #2: **the constraint that no core package may depend on `@ax-code/app` or `@ax-code/desktop` is already written in four different `ARCHITECTURE.md` files.** This PRD is not proposing a new architectural boundary — it is cleaning up the only surface that crossed an existing one. That reframing matters for reviewer confidence: this is a deletion of a leaf, not a refactor of a trunk.

The second-strongest finding is #3: **today's `ax-code web` only works when `app.ax-code.ai` is reachable.** That means the command is already effectively broken for any user behind a firewall, an airgap, or a captive portal — the exact environments ax-code's positioning targets. Leaving it in place doesn't preserve a working feature; it preserves a misleading one.

The recommendation is: **approve the removal, ship it in v2.4.0, and use one line in the release notes to reframe it as a positioning correction rather than a feature cut.**
