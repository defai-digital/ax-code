# ADR-021: Establish HTML Dev Browser Boundary via Playwright MCP and Behavioral Policy

## Status

Proposed

## Date

2026-05-26

## Deciders

To be filled by team

## Related

- ADR-020: Make MCP Security a Trust-Boundary Contract
- ADR-003: Keep OpenTUI and Bun as the mainline runtime
- `.internal/prd/PRD-2026-05-26-html-dev-browser-integration.md`
- `packages/ax-code/src/mcp/discovery.ts`
- `packages/ax-code/src/tool/bash.ts`
- `packages/ax-code/src/context/analyzer.ts`
- `packages/ui/src/pierre/media.ts`

## Context

ax-code agents assist users with HTML and web development, including HTML5 games. During these sessions the agent frequently executes browser-open commands (`open`, `xdg-open`, `start`) to verify its own output. These commands steal focus from the user's active browser session mid-debugging, which is a scored 2/5 UX weakness in user feedback.

The root problem is architectural: ax-code has no boundary between the agent's verification needs and the user's browser environment. When the agent wants to confirm HTML renders correctly, it has one tool available — opening the browser — which directly collides with the user's active work.

Competitor tools (Bolt, Lovable, Replit) solve this via embedded previews that are isolated from the user's primary browser context. ax-code is a terminal tool and cannot embed a browser iframe. However, the same isolation can be achieved through:

1. A **behavioral policy** that prevents the agent from autonomously opening the browser.
2. A **Playwright MCP integration** that gives the agent a non-intrusive verification path (screenshot via CDP, rendered in TUI).

The question is how to implement this without bundling a heavy dependency into ax-code and without adding friction to legitimate browser-open use cases.

## Decision

Establish the HTML dev browser boundary via three mechanisms, applied in sequence:

### 1. Agent behavioral policy (primary control)

The agent must treat browser-open commands during HTML development sessions as out-of-scope for autonomous execution. The system prompt for web/HTML project sessions must include explicit guidance: complete changes and report results in text; do not call `open`/`xdg-open`/`start` for verification. This is the highest-leverage change — it eliminates the problem regardless of tooling availability.

### 2. Bash tool browser-open interception (safety net)

The bash tool intercepts commands that match known browser-launchers (`open`, `xdg-open`, `start`, `sensible-browser`) when the target is a local file path or localhost URL. Instead of executing, it emits a structured "preview available" notification with an inline `[open]` action that the user can trigger on their own terms. This is a safety net: it catches cases where the behavioral policy is insufficient (legacy sessions, agent regressions, explicit user-requested opens that the user later wants to defer).

Intentional browser-open use cases — OAuth, account login, DRE graph visualization — are excluded from interception by checking call context.

### 3. Playwright MCP via MCP discovery infrastructure (verification capability)

`@playwright/mcp` (Microsoft's official MCP server, `npm:@playwright/mcp`) is added to the `CANDIDATES` array in `src/mcp/discovery.ts`. It is auto-suggested (not auto-enabled) when a web-app or HTML project is detected. This follows the exact same integration pattern as the existing `puppeteer` candidate.

When connected in CDP attach mode, `@playwright/mcp` lets the agent call `browser_screenshot` against the user's existing Chrome instance. The screenshot (base64 PNG) is rendered in the TUI via the existing `media.ts` data URL pipeline — no new image rendering infrastructure required. The user's browser focus is never touched.

Playwright is not bundled in ax-code. It lives entirely outside the ax-code package, run as an MCP subprocess. The MCP trust gate from ADR-020 applies: project-config-sourced Playwright MCP must go through user trust before connecting.

## Alternatives Considered

### Bundle Playwright directly in ax-code as a tool

Pros: simpler agent API surface, no MCP dependency.

Cons: ~300 MB+ addition to the package; complex install for end users; violates the "thin core, extend via MCP" architecture direction; Playwright's browser binaries are not appropriate to bundle in a CLI tool.

Decision: reject. Use MCP protocol to keep ax-code thin.

### Headless Playwright (no CDP, always new headless browser)

Pros: works even when user has no browser open; reproducible rendering.

Cons: opens a new invisible process for every verification call; does not show the live game state the user is debugging; slower than CDP attach; wasteful when the user's Chrome is already open.

Decision: prefer CDP attach mode as primary; headless as fallback when CDP is unavailable.

### Permission gate (block `open` and ask every time)

Pros: gives user control on every call.

Cons: adds friction to all browser opens including legitimate cases; interrupts agent workflow with a confirmation prompt; does not give the agent an alternative verification path; results in a worse experience for users who intentionally request browser opens.

Decision: reject as primary control. Use behavioral policy + notification (not a blocking prompt) instead.

### Embedded terminal browser (e.g., w3m, lynx)

Pros: no external dependency, fully inline.

Cons: cannot render HTML5 canvas or WebGL (breaks for game development specifically); significant layout differences from real browsers; would mislead the agent.

Decision: reject for HTML game development context. Playwright is the correct tool.

### Dev server proxy with screenshot endpoint

Pros: no Playwright required; ax-code controls the full pipeline.

Cons: requires injecting a screenshot capture script into the user's dev server or page; fragile for arbitrary HTML files; complex to implement correctly; security surface concerns.

Decision: reject. Playwright MCP is cleaner and already handles this.

## Best Practices

### Behavioral policy is primary, tooling is secondary

The agent behavioral policy ships first. The Playwright MCP integration is additive capability, not a prerequisite. Even without Playwright configured, the agent should not open the user's browser autonomously.

### Never bundle browser binaries or Playwright in ax-code

The `@playwright/mcp` MCP server runs as a subprocess. ax-code does not import or depend on `@playwright/*` packages. This keeps the install lightweight and leaves the browser binary management to the user (or to `npx @playwright/mcp` on demand).

### CDP attach first, headless as fallback

Prefer connecting to an existing Chrome instance (default CDP port 9222) over launching a new headless browser. During HTML development the user's browser is almost always open. CDP attach gives the agent a live view of what the user sees and avoids spawning unnecessary processes.

Auto-detect CDP port availability as part of the Playwright MCP candidate check. If CDP is not available, fall back to `--browser chromium --headless` mode.

### Apply ADR-020 trust gate to Playwright MCP

`@playwright/mcp` from project config is untrusted until the user explicitly grants trust. Global user config may auto-connect. Do not bypass the trust gate even though Playwright is a well-known package — the CDP connection gives the agent significant capability over the user's browser.

### Browser-open interception must preserve legitimate flows

The bash tool interception must not block:
- OAuth and account login browser opens (identified by URL pattern, not file path)
- DRE graph visualization opens (identified by `DreGraphServer` call context)
- Explicit user-requested opens (identified by user's direct instruction in the session)

Use a targeted pattern — local file paths and `localhost`/`127.0.0.1` URLs only — rather than intercepting all `open` calls.

### Screenshot rendering uses existing TUI infrastructure

`browser_screenshot` returns a base64-encoded PNG. The TUI already handles this via `media.ts` `toDataUrl()` and `FileMedia`. Wire the MCP tool result into the existing image rendering path. Do not create a parallel image display path.

## Pros And Cons

### Behavioral policy (Layer 0)

Pros:
- Zero engineering effort; ships immediately via system prompt update.
- Addresses the root cause, not just symptoms.
- Works regardless of whether Playwright is configured.

Cons:
- Cannot enforce at runtime; model may still use `open` if not guided correctly.
- Does not give the agent a verification alternative.

Decision: adopt as the primary and first-shipped layer.

### Bash tool browser-open interception (Layer 1)

Pros:
- Runtime enforcement regardless of model behavior.
- Non-blocking (notification, not a confirm prompt).
- No new dependencies.
- Covers regression cases when behavioral policy is insufficient.

Cons:
- Requires careful exclusion of legitimate browser-open cases.
- Adds a code path in the bash tool that must be maintained.

Decision: adopt as a safety net layer.

### Playwright MCP via discovery (Layers 2–3)

Pros:
- Gives the agent a real verification alternative.
- No bundled dependency; Playwright runs as MCP subprocess.
- CDP attach reuses the user's existing browser; no new visible window.
- Screenshot renders in TUI via existing infrastructure.
- Follows established MCP discovery pattern.

Cons:
- Requires user to install `@playwright/mcp` or allow `npx` to run it.
- CDP attach requires Chrome to be running with `--remote-debugging-port`.
- Adds a new MCP candidate to maintain.
- Trust gate (ADR-020) adds a one-time user action before first use.

Decision: adopt. The benefits justify the setup cost; auto-suggest in `mcp --discover` reduces friction.

## Consequences

### Immediate

- Agent behavioral guidance updated for HTML/web project sessions.
- Bash tool gains a browser-open interception path.
- `src/mcp/discovery.ts` gains a `playwright` candidate.
- `src/context/analyzer.ts` web-app detection wired to Playwright suggestion.

### Long-term

- Playwright MCP opens a path to richer HTML verification: accessibility checks, console error capture, interaction replay.
- CDP foundation is reusable for future visual regression or performance tooling.
- The browser-isolation principle established here can extend to other agent actions that would otherwise disrupt user environment state.
