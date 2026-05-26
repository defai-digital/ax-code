# Implementation Plan: HTML Dev Browser Integration

**PRD:** PRD-2026-05-26-html-dev-browser-integration.md
**ADR:** ADR-021-html-dev-browser-boundary.md
**Date:** 2026-05-26
**Status:** Proposed

---

## Phase 0 — Behavioral Policy (no code, ships first)

**Goal:** Stop the bleed immediately without any engineering work.

**Changes:**

- Update the system prompt for HTML/web project sessions (`src/session/prompt.ts` or the relevant prompt-* module).
- Add guidance: "For HTML/web projects, do not call `open`, `xdg-open`, `start`, or `sensible-browser` to verify output. Apply changes, then report 'changes applied — refresh your browser to see the update.'"
- Extend `src/context/analyzer.ts` HTML detection to flag `index.html` at root in addition to the existing `src/app` / `app` directory check.

**Files touched:**
- `packages/ax-code/src/session/` (system prompt module — exact file TBD by reading `src/session/prompt-*.ts`)
- `packages/ax-code/src/context/analyzer.ts`

**Done when:** Agent no longer opens browser autonomously in a fresh HTML game session using the updated system prompt. Verify manually with a sample session.

**Effort:** S (< 1 day)

---

## Phase 1 — Bash Tool Browser-Open Interception

**Goal:** Runtime safety net so the behavioral policy has a hard backstop.

**Approach:**

In `packages/ax-code/src/tool/bash.ts`, before executing a command, check if it matches the browser-open pattern:

```
Pattern: command starts with one of: open, xdg-open, start, sensible-browser
Target: argument is a local file path (*.html, *.htm) or localhost/127.0.0.1 URL
```

When matched:
1. Do not execute the command.
2. Emit a `browser_preview_available` structured event (new event type in the tool result).
3. TUI renders this as a toast/inline action: "Preview ready at `<path>` — [open in browser]".
4. User can click the action to open; the agent does not need to re-request.

**Exclusions (must NOT intercept):**
- OAuth callback URLs (contain `/callback`, `/oauth`, `/auth`)
- DRE graph URLs (contain `dre-graph` or port pattern from `DreGraphServer`)
- Commands where the session has an explicit "open browser" user intent in the last message

**Files touched:**
- `packages/ax-code/src/tool/bash.ts` — add pre-execution intercept
- `packages/ax-code/src/cli/cmd/tui/` — add `browser_preview_available` event rendering (toast + action button)

**Done when:**
- `open index.html` in a bash tool call emits notification instead of opening browser.
- Clicking the notification opens the browser correctly.
- OAuth and DRE graph opens are unaffected.
- Unit test: mock bash tool with `open index.html` → assert no subprocess spawned, event emitted.

**Effort:** M (1–2 days)

---

## Phase 2 — Playwright MCP Discovery

**Goal:** Make `@playwright/mcp` auto-suggested in web/HTML projects.

**Approach:**

Add a new candidate to the `CANDIDATES` array in `packages/ax-code/src/mcp/discovery.ts`:

```ts
{
  name: "playwright",
  description: "Browser automation and screenshot via Playwright MCP",
  check: async (cwd: string) => {
    const hasIndexHtml = await fileExists(path.join(cwd, "index.html"))
    const projectType = detectProjectTypeSync(cwd)
    const isWebApp = projectType === "web-app" || hasIndexHtml
    if (!isWebApp) return false
    // Check npx is available (Playwright MCP runs via npx)
    return commandExists("npx")
  },
  config: {
    command: "npx",
    args: ["@playwright/mcp@latest", "--cdp-url", "http://localhost:9222"],
  },
}
```

Wire `src/context/analyzer.ts` project type detection to be importable by `discovery.ts` without circular dependency (extract to `src/context/project-type.ts` if needed).

**ADR-020 trust gate:** Project-config-sourced Playwright MCP goes through the standard trust gate. Global user config may auto-connect after first `mcp --discover` acceptance.

**Files touched:**
- `packages/ax-code/src/mcp/discovery.ts` — add `playwright` candidate
- `packages/ax-code/src/context/analyzer.ts` (or new `src/context/project-type.ts`) — export detection function

**Done when:**
- `ax-code mcp --discover` in a project with `index.html` shows `playwright` as a suggested server.
- `ax-code mcp --discover` in a non-web project does not show `playwright`.
- Trust gate prevents auto-connect from project config without user approval.
- Unit test: mock filesystem with `index.html` → assert `playwright` in discovered candidates.

**Effort:** S (< 1 day)

---

## Phase 3 — CDP Attach + TUI Screenshot Rendering

**Goal:** Agent can verify HTML output via screenshot without touching user's browser.

**Approach:**

**CDP auto-detection:**
Add a CDP port check to the Playwright MCP candidate in Phase 2. If Chrome is running with `--remote-debugging-port=9222` (default), the candidate's `check()` returns a CDP-attach config. If not, fall back to headless mode config:

```ts
const cdpAvailable = await checkPort(9222)  // lightweight TCP connect check
config.args = cdpAvailable
  ? ["@playwright/mcp@latest", "--cdp-url", "http://localhost:9222"]
  : ["@playwright/mcp@latest", "--browser", "chromium", "--headless"]
```

**TUI screenshot rendering:**
`@playwright/mcp`'s `browser_screenshot` tool returns a base64 PNG as an MCP tool result image content block. Wire this into the existing rendering pipeline:

- MCP tool results with `type: "image"` and `mimeType: "image/png"` already pass through the result pipeline.
- Ensure `media.ts` `toDataUrl()` is called for these results.
- `FileMedia` component renders inline in the tool result panel.
- Verify the existing image size cap is respected (no oversized screenshots blocking the TUI).

**Agent guidance update:**
Add to system prompt (Phase 0 update): "When `playwright` MCP is connected, use `browser_screenshot` to verify HTML rendering instead of opening a new browser window."

**Files touched:**
- `packages/ax-code/src/mcp/discovery.ts` — CDP port detection in Playwright candidate
- `packages/ax-code/src/cli/cmd/tui/` — verify MCP image content block renders via `media.ts`
- `packages/ax-code/src/session/` — extend agent guidance for Playwright-connected sessions

**Done when:**
- With Chrome open at CDP port 9222, `browser_screenshot` in a session returns a PNG that renders inline in TUI.
- Without Chrome open, falls back to headless and still renders screenshot.
- Screenshot renders within 1.5s on local machine.
- Integration test: start a real `@playwright/mcp` server in test, call `browser_screenshot`, assert base64 PNG appears in TUI tool result.

**Effort:** M (2–3 days)

---

## Phase 4 — Polish and Observability

**Goal:** Harden the integration, add logging, close edge cases.

**Tasks:**

- Log structured events for all browser-open intercepts: `{ toolName: "bash", command: "open", intercepted: true, durationMs }`.
- Handle the case where the user installs `@playwright/mcp` globally vs. via npx — detection should work for both.
- Add a `browser.interceptOpen` config key (`true` by default) so power users can opt out of interception.
- Add a `[don't intercept this]` escape hatch in the TUI notification for one-off legitimate opens.
- Document the Playwright MCP setup in the relevant docs page (CDP port, headless fallback, security note).
- Add the `playwright` candidate to the MCP section of `AGENTS.md` auto-generation if the project is web-app type.

**Files touched:**
- `packages/ax-code/src/tool/bash.ts` — config opt-out + logging
- `packages/ax-code/src/mcp/discovery.ts` — global install detection
- Docs (exact path TBD)
- `packages/ax-code/src/context/analyzer.ts` — AGENTS.md generation for web projects

**Effort:** S (< 1 day)

---

## Dependency Graph

```
Phase 0 (prompt)
    ↓
Phase 1 (bash intercept)   ←— can run in parallel with Phase 2
Phase 2 (MCP discovery)    ←— can run in parallel with Phase 1
    ↓
Phase 3 (CDP + TUI screenshot)   ←— requires Phase 2
    ↓
Phase 4 (polish)   ←— requires all above
```

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Bash intercept false-positives (blocks legitimate `open` calls) | Medium | High | Tight exclusion list; opt-out config key; escape hatch in TUI |
| Chrome CDP port 9222 not available in most dev environments | High | Low | Headless fallback; graceful degradation; no forced CDP |
| `@playwright/mcp` API changes (it's Microsoft-maintained) | Low | Medium | Version-pin in discovery config; test on each update |
| Trust gate friction discourages Playwright adoption | Medium | Medium | Global user config auto-connects after first approval; clear UX copy |
| Screenshot size floods TUI | Low | Medium | Existing image size cap in `media.ts`; enforce max 1280×800 in Playwright config |

## Total Estimated Effort

| Phase | Effort | Owner |
| --- | --- | --- |
| Phase 0 — Behavioral policy | S (< 1 day) | |
| Phase 1 — Bash intercept | M (1–2 days) | |
| Phase 2 — MCP discovery | S (< 1 day) | |
| Phase 3 — CDP + TUI screenshot | M (2–3 days) | |
| Phase 4 — Polish | S (< 1 day) | |
| **Total** | **~6–8 days** | |
