---
name: run
description: Launch and drive this project's app to see a change working. Use when asked to run, start, or screenshot the app.
agent: build
argument-hint: <optional specific page or feature to navigate to>
---

Launch the project's application and confirm it is running. If $ARGUMENTS specifies a page or feature, navigate there.

## Phase 1 - Detect How to Run

Inspect the project to determine the correct run command:

1. Check `package.json` scripts: prefer `dev`, `start`, `serve` (in that order).
2. Check for `Makefile` with a `run` or `dev` target.
3. Check for `docker-compose.yml` (use `docker compose up`).
4. Check for framework-specific configs: `next.config.*`, `vite.config.*`, `nuxt.config.*`, `angular.json`.
5. If AGENTS.md or README documents a run command, use that.

## Phase 2 - Start

- Run the detected command in the background (use `run_in_background: true`).
- Wait for the server to be ready: poll the expected port (default 3000, 5173, 8080) with curl until it responds or 30s elapses.
- If startup fails, read the output, diagnose, and report the error.

## Phase 3 - Observe

- If browser tools are available: open the app URL, take a snapshot, and capture a screenshot.
- If $ARGUMENTS specifies a route or page, navigate there.
- If browser tools are NOT available: curl the root URL and report the HTTP status + first 500 bytes of the response.

## Phase 4 - Report

- Confirm the app is running with: URL, HTTP status, and a brief description of what rendered.
- If a screenshot was captured, include it.
- Leave the dev server running in the background (report the shell ID so it can be killed later).

## Constraints

- Do not modify source code.
- Do not install new dependencies unless the project's own setup script does so.
- If the app requires environment variables or secrets that are missing, report what's needed and stop.
