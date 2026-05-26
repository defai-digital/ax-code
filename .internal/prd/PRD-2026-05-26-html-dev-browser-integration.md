# PRD: HTML Dev Browser Integration

**Date:** 2026-05-26
**Status:** Implemented
**Scope:** Internal
**Owner:** ax-code maintainers
**Related:** ADR-021 (HTML Dev Browser Boundary), ADR-020 (MCP Security Trust Boundary), `packages/ax-code/src/mcp/discovery.ts`, `packages/ax-code/src/tool/bash.ts`, `packages/ax-code/src/context/analyzer.ts`
**Archive criteria:** Browser-open detection in bash tool shipped; `@playwright/mcp` added to MCP candidates and wired to web-app detection; TUI screenshot rendering confirmed via integration test; agent behavioral guidance documented and in system prompt.

---

## Purpose

Eliminate the "mid-debug browser push" problem during HTML development sessions.

When a user is debugging an HTML game or web app, the agent unexpectedly opens or pushes content to the browser, stealing focus and breaking the debug loop. Competitors (Bolt, Lovable, Replit) solve this via isolated embedded previews. ax-code is a terminal tool and cannot embed a browser iframe, but it can achieve the same isolation by (a) controlling when the agent opens the browser and (b) giving the agent a non-intrusive way to verify HTML output.

## Problem

User feedback (scored 2/5 weakness):

> "Transferring into local HTML instances is frustrating. During game development, work was frequently and unexpectedly pushed to the browser mid-bug-fix, significantly disrupting the development loop."

Root cause: The agent uses `open`/`xdg-open`/`start` commands via the bash tool to verify HTML output. These fire unconditionally and immediately interrupt the user's active browser session. ax-code has no browser–agent isolation layer.

Competitor gap:

| Tool | Isolation model |
| --- | --- |
| Bolt.new | Embedded WebContainer iframe — preview never touches user browser |
| Lovable.dev | Sandboxed embedded preview — same isolation |
| Replit | Sidebar preview panel — explicit run trigger, no focus steal |
| Cursor | No auto-browser open at all — agent never pushes to browser |

ax-code's gap is not missing tooling — it is missing a **behavioral boundary** between the agent's verification needs and the user's active browser environment.

## Goals

1. Agent no longer autonomously opens the user's browser mid-session without explicit user request.
2. Agent can verify HTML output (screenshot, console errors) without a visible browser window.
3. When a browser preview is available, the user sees it inline in the TUI — not as a stolen focus event.
4. The Playwright integration uses ax-code's existing MCP infrastructure, adding no new bundled dependencies.
5. CDP attach mode allows connecting to the user's already-open browser, so the agent sees the live game state.

## Non-Goals

- A fully embedded browser preview inside the TUI (requires terminal emulator-level work; deferred).
- Replacing the user's browser or dev server workflow.
- Playwright-based automated test generation (separate concern; different PRD if pursued).
- Changing behavior for OAuth browser opens (intentional, unrelated flow).

## Competitive Analysis

### What competitors do right

Bolt and Lovable achieve isolation through embedded WebContainers — the agent's preview runs in a sandboxed iframe inside the product UI. The user's browser tab is the product; the preview is a sub-frame. The agent never touches the user's primary browser context.

Cursor and GitHub Copilot take the opposite approach: the agent makes no assumptions about browser state. The user runs their own dev server; the agent informs but does not act.

Replit sits in the middle: an explicit preview panel that the user controls. The agent can request a refresh, but the user decides when to look.

### What ax-code should adopt

The Cursor model is the right anchor for ax-code as a terminal tool:

- Agent does not open browsers autonomously.
- Agent communicates results through text and screenshots, not browser events.
- User retains full control over their browser environment.

Playwright MCP in CDP attach mode adds one enhancement: the agent can capture a screenshot of the user's existing browser tab and display it in the TUI, giving the agent verification capability without any new visible window.

## Solution Overview

Four layers, from behavioral (no code) to infrastructure (new capability):

**Layer 0 — Behavioral policy (agent prompt)**
The agent must not call `open`/`xdg-open`/`start`/`sensible-browser` autonomously during HTML development sessions. It should instead report "changes applied — refresh your browser to see the update." This layer costs zero engineering effort and ships first.

**Layer 1 — Bash tool browser-open interception**
Detect browser-open commands in the bash tool. Instead of executing, notify the user that a preview is available and provide an inline action to open it. The agent's workflow is not blocked; the user chooses when to switch to the browser.

**Layer 2 — Playwright MCP discovery**
Add `@playwright/mcp` (Microsoft's official MCP server) to `src/mcp/discovery.ts` CANDIDATES. Auto-suggest when the project is detected as a web app or when HTML files are found at root. This follows the exact same pattern as the existing `puppeteer` candidate. No Playwright code is bundled in ax-code.

**Layer 3 — CDP attach + TUI screenshot display**
Configure `@playwright/mcp` in CDP attach mode so it connects to the user's already-open Chrome. The agent calls `browser_screenshot` and the result (base64 PNG) renders in the TUI via the existing `media.ts` + `FileMedia` pipeline. Zero new image-rendering work required.

## Requirements

### P0 (Layer 0 — must ship first)

- [x] Agent behavioral guidance updated: never autonomously call browser-open commands during active HTML development sessions.
- [x] System prompt includes explicit instruction for HTML/web projects: "report changes, do not open browser."

### P1 (Layer 1 — bash tool)

- [x] Bash tool detects `open`, `xdg-open`, `start`, `sensible-browser` commands against local file paths or localhost URLs.
- [x] Instead of executing, returns "preview available" message; OAuth/DRE/MCP flows excluded via passthrough regex.
- [x] Does not intercept browser opens for OAuth, account login, or DRE graph (those are intentional).
- [x] Detection pattern is configurable: `browser.interceptOpen: false` in `ax-code.json` disables interception.

### P1 (Layer 2 — MCP discovery)

- [x] `@playwright/mcp` added to `CANDIDATES` in `src/mcp/discovery.ts`.
- [x] Detection condition: `index.html`/`index.htm` at root, OR `src/app`/`app` directory (web-app type), OR `playwright`/`@playwright/test` in `package.json`.
- [x] `mcp --discover` surfaces the Playwright server as a suggestion in web projects.
- [x] MCP trust gate (ADR-020) applied via existing infrastructure — project config sources require user trust before auto-connecting.

### P2 (Layer 3 — CDP + TUI)

- [x] `@playwright/mcp` launch config supports `--cdp-url` (CDP attach) when Chrome port 9222 is open, falls back to `--headless` otherwise. Auto-detected at discovery time via TCP probe.
- [x] TUI renders `browser_screenshot` output inline: `collectMcpToolContent` converts MCP image blocks to `data:image/png;base64,...` `FilePart` URLs; TUI displays as `img` badge. Confirmed by integration tests.
- [x] Agent guidance updated: `<html_dev_workflow>` in system prompt instructs use of `browser_screenshot` when playwright MCP is connected.
- [x] Auto-detection of Chrome CDP port (default 9222) via `checkTcpPort` utility in `mcp/discovery.ts`.

## Success Metrics

- Zero involuntary browser focus-steal events during HTML development sessions after Layer 1 ships.
- Playwright MCP auto-suggested in `mcp --discover` for all web-app projects.
- Screenshot appears inline in TUI within 1.5s of `browser_screenshot` call on a local dev machine.

## Done When

P0 agent guidance in system prompt; P1 bash tool interception and MCP discovery shipped and tested; P2 CDP attach + TUI screenshot rendering confirmed via integration test with a real Chrome instance.
