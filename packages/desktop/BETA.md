# AX Code Desktop Beta Runbook

This runbook is for internal maintainer beta builds of the first-party AX Code desktop app.

## Scope

The beta app is a local desktop shell for AX Code. It can run against fixture renderer state, start a local AX Code
sidecar backend for a checkout, or attach to an existing loopback backend. It is not a signed public release.

## Run From Source

Start the renderer in dev mode:

```sh
pnpm --dir packages/app run dev
```

Start the desktop host against the dev renderer and an owned sidecar backend:

```sh
pnpm --dir packages/desktop run dev -- --directory /path/to/project
```

Attach to an existing loopback backend instead of owning the sidecar:

```sh
pnpm --dir packages/desktop run dev -- --attach-url http://127.0.0.1:4096 --auth-header "Bearer <token>"
```

Attach mode accepts only HTTP(S) loopback URLs and checks `/global/health` with the supplied auth before the renderer gets
a live connection. A missing or rejected auth header fails startup with an attach-auth error instead of surfacing a stale
connected state.

The desktop host keeps renderer privileges sandboxed. Backend start, attach, log export, notification, directory picker,
path reveal, and external-open actions must cross the typed preload bridge.

## Build A Local macOS Bundle

```sh
pnpm --dir packages/app run build
pnpm --dir packages/desktop run build
pnpm --dir packages/desktop run package:mac
```

The local bundle is written to:

```text
packages/desktop/dist/mac/AX Code.app
```

The bundle includes `Contents/Resources/app/ax-code-release.json`. For local beta builds, signing, notarization, and
updater gates must remain closed in that manifest.

## Required Beta Checks

Run these before handing a local bundle to another maintainer:

```sh
pnpm --dir packages/app run typecheck
pnpm --dir packages/app run test
pnpm --dir packages/app run test:e2e
pnpm --dir packages/app run build
pnpm --dir packages/app run perf:smoke
pnpm --dir packages/app run qa:beta
pnpm --dir packages/desktop run typecheck
pnpm --dir packages/desktop run test
pnpm --dir packages/desktop run build
pnpm --dir packages/desktop run package:mac
pnpm --dir packages/desktop run smoke:packaged
pnpm --dir packages/desktop run smoke:renderer
pnpm run check:structure
```

Do not run root `pnpm test`; the repository root intentionally rejects it.
`smoke:packaged` covers the Electron package payload, macOS `.app` manifest, custom app protocol, sandboxed renderer
plan, bridge-to-sidecar/attach lifecycle wiring, diagnostics log export, startup failure diagnostics, renderer crash
diagnostics, loopback proxy bypass, clean shutdown lifecycle wiring, and packaged preload bridge
allowlist/no-raw-IPC/menu-command filtering.
The preload allowlists must match the typed bridge schema and desktop menu command catalog exactly; extra packaged
commands fail the smoke gate.
`smoke:renderer` covers packaged renderer content, accessibility landmarks, visible focus styling, keyboard traversal,
event-stream banner visibility, and desktop viewport overflow.
`qa:beta` covers long-session/large-queue replay plus synthetic transient event-stream reconnect recovery.

## Evidence Bundle

For maintainer handoff, collect the JSON outputs and command status into one machine-readable bundle. The preferred path
is the collector, which runs the required package-scoped checks, writes command logs, records command outcomes, and then
builds the evidence bundle:

```sh
pnpm --dir packages/desktop run beta:collect -- \
  --output-dir /private/tmp/ax-code-desktop-beta \
  --mac-bundle-path "packages/desktop/dist/mac/AX Code.app" \
  --qa-live-directory /path/to/project \
  --strict \
  --require-live-qa
```

With only `--qa-live-directory`, the collector runs sidecar QA and also starts a temporary loopback backend for attach QA
using `qa:live --attach-from-directory`; this verifies attach-mode behavior without putting generated auth headers in
the command evidence. The headless SDK resolves random backend startup to a concrete loopback port before spawning the
CLI, so the live QA path does not depend on `ax-code serve --port=0` behavior. To test against a specific
already-running backend instead, pass `--qa-live-attach-url` and, when needed, `--qa-live-auth-header`.

For wider beta handoff, make live QA representative instead of only connected. Add `--representative-live-qa` plus
minimum thresholds that match the project being tested:

```sh
pnpm --dir packages/desktop run beta:collect -- \
  --output-dir /private/tmp/ax-code-desktop-beta \
  --mac-bundle-path "packages/desktop/dist/mac/AX Code.app" \
  --qa-live-directory /path/to/project \
  --strict \
  --require-live-qa \
  --representative-live-qa \
  --qa-live-min-sessions 1 \
  --qa-live-min-visible-messages 50 \
  --qa-live-min-applied-events 1
```

The representative gate is intentionally configurable. Use higher thresholds for projects with known long-session
history or active queue state, for example `--qa-live-min-queue-items 2` or `--qa-live-min-scheduled-tasks 1`.
Representative live QA hydrates message history through the public session messages route and, when needed, scans the
listed sessions for a longer-history target before enforcing visible-message thresholds.

`beta:collect` continues after individual command failures so the bundle shows all available evidence. It exits non-zero
when the generated bundle is not ready. A strict bundle fails when any required beta artifact is missing, failed, or
skipped, and command evidence for JSON-producing checks must point at the same output files the bundle validates.
For a public release candidate, pass `--require-release-pipeline`, `--update-manifest-path`, and
`--release-archive-path` to the collector as well; it forwards those external release artifacts into the generated
evidence bundle.

If a local environment cannot run the hidden Electron renderer smoke, use `--skip-renderer-smoke` only for partial
diagnostics; strict handoff will remain failed until renderer smoke evidence is present.

Manual collection is still possible when rerunning only one part of the gate.

Suggested output paths:

```sh
mkdir -p /private/tmp/ax-code-desktop-beta
pnpm --dir packages/app run qa:beta -- --output /private/tmp/ax-code-desktop-beta/qa-beta.json
pnpm --dir packages/desktop run smoke:packaged -- --output /private/tmp/ax-code-desktop-beta/packaged-smoke.json
pnpm --dir packages/desktop run smoke:renderer -- --output /private/tmp/ax-code-desktop-beta/renderer-smoke.json
```

Record the required command outcomes in `/private/tmp/ax-code-desktop-beta/commands.json`:

```json
{
  "commands": [
    { "name": "app:typecheck", "command": "pnpm --dir packages/app run typecheck", "status": "passed" },
    { "name": "app:test", "command": "pnpm --dir packages/app run test", "status": "passed" },
    { "name": "app:test:e2e", "command": "pnpm --dir packages/app run test:e2e", "status": "passed" },
    { "name": "app:build", "command": "pnpm --dir packages/app run build", "status": "passed" },
    { "name": "app:perf:smoke", "command": "pnpm --dir packages/app run perf:smoke", "status": "passed" },
    { "name": "app:qa:beta", "command": "pnpm --dir packages/app run qa:beta", "status": "passed" },
    {
      "name": "app:qa:live:sidecar",
      "command": "pnpm --dir packages/app run qa:live -- --directory /path/to/project",
      "status": "passed"
    },
    {
      "name": "app:qa:live:attach",
      "command": "pnpm --dir packages/app run qa:live -- --attach-url http://127.0.0.1:4096 --auth-header \"Bearer <token>\"",
      "status": "passed"
    },
    { "name": "desktop:typecheck", "command": "pnpm --dir packages/desktop run typecheck", "status": "passed" },
    { "name": "desktop:test", "command": "pnpm --dir packages/desktop run test", "status": "passed" },
    { "name": "desktop:build", "command": "pnpm --dir packages/desktop run build", "status": "passed" },
    { "name": "desktop:package:mac", "command": "pnpm --dir packages/desktop run package:mac", "status": "passed" },
    {
      "name": "desktop:smoke:packaged",
      "command": "pnpm --dir packages/desktop run smoke:packaged",
      "status": "passed"
    },
    {
      "name": "desktop:smoke:renderer",
      "command": "pnpm --dir packages/desktop run smoke:renderer",
      "status": "passed"
    },
    { "name": "repo:check:structure", "command": "pnpm run check:structure", "status": "passed" }
  ]
}
```

After collecting `qa:live` sidecar and attach evidence, build the strict bundle:

```sh
pnpm --dir packages/desktop run beta:evidence -- \
  --mac-bundle-path "packages/desktop/dist/mac/AX Code.app" \
  --qa-beta /private/tmp/ax-code-desktop-beta/qa-beta.json \
  --qa-live-sidecar /private/tmp/ax-code-desktop-beta/qa-live-sidecar.json \
  --qa-live-attach /private/tmp/ax-code-desktop-beta/qa-live-attach.json \
  --renderer-smoke /private/tmp/ax-code-desktop-beta/renderer-smoke.json \
  --packaged-smoke /private/tmp/ax-code-desktop-beta/packaged-smoke.json \
  --command-evidence /private/tmp/ax-code-desktop-beta/commands.json \
  --strict \
  --require-representative-live-qa \
  --output /private/tmp/ax-code-desktop-beta/evidence-bundle.json
```

The bundle includes release readiness, closed public-release gate warnings, `qa:beta`, both `qa:live` modes, renderer
smoke, packaged smoke, and the required command evidence. Strict command evidence couples each JSON-producing command's
`outputPath` to the artifact path being validated, so stale or mismatched evidence files fail the bundle. Use
`--require-representative-live-qa` only when the `qa:live` files were collected with representative thresholds. Public
release evidence still needs `--require-release-pipeline` plus `--update-manifest-path` and `--release-archive-path` so
the bundle verifies the external update feed JSON and archive bytes that correspond to the signed app's feed locator.

## Live Backend QA

Run these against a representative checkout before a wider beta. They require either an owned sidecar start or an already
running loopback backend:

```sh
pnpm --dir packages/app run qa:live -- --directory /path/to/project --output /private/tmp/ax-code-desktop-beta/qa-live-sidecar.json
pnpm --dir packages/app run qa:live -- --attach-url http://127.0.0.1:4096 --auth-header "Bearer <token>" --output /private/tmp/ax-code-desktop-beta/qa-live-attach.json
```

`qa:live` bootstraps real command-center state, verifies renderer message/queue windows stay bounded, follows the live
event stream through reconnect handling, and reports whether it started the sidecar or used an attached backend. Attach
mode performs a `/global/health` preflight so unreachable or unauthorized backends fail with an actionable setup error.

To make long-session coverage a hard gate, pass representative thresholds directly:

```sh
pnpm --dir packages/app run qa:live -- \
  --directory /path/to/project \
  --representative \
  --min-sessions 1 \
  --min-visible-messages 50 \
  --min-applied-events 1 \
  --output /private/tmp/ax-code-desktop-beta/qa-live-sidecar.json
```

The JSON output includes `representative.required`, per-check actual/minimum values, and `representative.passed`.
The current checkout has passing representative evidence under
`/private/tmp/ax-code-desktop-beta-representative/evidence-bundle.json`, collected with at least 1 session, 50 visible
messages, and 1 applied stream event required for both sidecar and attach modes.

After building the macOS bundle and collecting both `qa:live` outputs, run the beta readiness gate:

```sh
pnpm --dir packages/desktop run beta:check -- --mac-bundle-path "packages/desktop/dist/mac/AX Code.app" --qa-live-sidecar /private/tmp/ax-code-desktop-beta/qa-live-sidecar.json --qa-live-attach /private/tmp/ax-code-desktop-beta/qa-live-attach.json --require-live-qa
```

For internal beta, closed signing, notarization, and updater gates are reported as warnings. Public release readiness
must pass `--require-release-pipeline`, which fails until signed, notarized, update-feed-backed artifacts exist. In
public-release mode the readiness report also verifies that the local update feed JSON and release archive exist and
that the archive size and SHA-256 match the external update feed. The installed release manifest carries only the signed
release gates and update feed locator, avoiding self-referential archive hashes inside the signed app bundle.

Public macOS release artifacts are produced by the release pipeline command once Apple credentials and an update feed are
available:

```sh
pnpm --dir packages/desktop run release:mac:preflight -- --signing-identity "Developer ID Application: Example" --notary-profile ax-code-notary --update-feed-url https://updates.example.test/ax-code/ --output packages/desktop/dist/mac/ax-code-release-preflight.json
pnpm --dir packages/desktop run release:mac -- --version 1.2.3 --signing-identity "Developer ID Application: Example" --notary-profile ax-code-notary --update-feed-url https://updates.example.test/ax-code/
pnpm --dir packages/desktop run beta:check -- --mac-bundle-path "packages/desktop/dist/mac/AX Code.app" --require-release-pipeline --update-manifest-path packages/desktop/dist/mac/ax-code-update.json --release-archive-path "packages/desktop/dist/mac/AX Code.app.zip" --output packages/desktop/dist/mac/ax-code-release-readiness.json
```

`release:mac:preflight` checks the macOS runner, release tools, `notarytool`, `stapler`, signing identity visibility,
notarization credentials, `notarytool` keychain-profile usability when `--notary-profile` is used, and HTTPS update feed
URL before the release command mutates artifacts. Its `--output` report is safe to publish because it records pass/fail
state and reasons, not credentials.

`release:mac` writes the signed-app release gate locator before signing so the manifest is covered by the app signature,
then signs the app bundle with hardened runtime, verifies the signature with `codesign --verify`, archives it, submits
the archive through Apple notarization, staples and validates the notarization ticket, creates the final archive, and
writes an external HTTPS update feed manifest with archive size and SHA-256. If signing, notarization, staple validation,
final archive creation, or update-feed evidence fails, the local bundle manifest is restored to closed public-release
gates and no desktop release assets should be published.

The tag-driven GitHub release workflow runs the same desktop release path in `desktop-mac-release`. It imports the Apple
certificate from `APPLE_CERTIFICATE_BASE64`, uses `APPLE_CERTIFICATE_PASSWORD` and `APPLE_SIGNING_IDENTITY`, then creates
a temporary `notarytool` keychain profile from the Apple ID secret triplet `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Local/manual release commands can still use an existing
`--notary-profile`, but the GitHub-hosted runner does not assume a pre-existing keychain profile. The workflow runs
the AX Code deterministic test gate before build/publish/desktop release jobs and uploads
`ax-code-deterministic-test-report` with `if: always()` so pre-desktop release failures keep a machine-readable JUnit
artifact. It then runs packaged smoke plus renderer smoke, runs
`release:mac:preflight`, runs `release:mac`, enforces `beta:check --require-release-pipeline`, then reruns packaged and
renderer smoke with JSON outputs against the final release bundle. It uploads the macOS archive,
`ax-code-update-darwin.json`, `ax-code-release-preflight.json`, `ax-code-release-readiness.json`,
`ax-code-desktop-packaged-smoke.json`, and `ax-code-desktop-renderer-smoke.json` to the GitHub release. The workflow
derives the update feed URL from the GitHub release download URL for the tag. If Apple
credentials are missing, the workflow leaves CLI release assets intact and writes an explicit skipped desktop release
summary.

At runtime the renderer can request `release.checkUpdate` through the desktop bridge. The bridge reads the installed
release manifest, fetches only that configured feed, validates that the feed is for AX Code on the current platform and
that the artifact URL is HTTPS with SHA-256 and size metadata, then reports current/available/error state in Diagnostics.
When an update is available, the renderer can request `release.downloadUpdate` with no URL payload. The bridge reuses the
installed feed, requires the artifact URL to stay under the configured feed URL, verifies byte size and SHA-256 before
writing, and reports the downloaded artifact path in Diagnostics with a reveal action. It does not auto-install or
execute the artifact.

## Diagnostics

Use the in-app Diagnostics panel to confirm:

- runtime mode and backend URL;
- event-stream status and applied event count;
- queue health and visible renderer window sizes;
- review artifact previews for findings, verification envelopes, review results, debug cases, and decision hints;
- terminal/browser/file pane feature policy; trusted local beta enables all three by default;
- capability profile counts; only the trusted local app should have desktop bridge commands, browser preview should have
  no bridge, and remote/tunnel/PWA/VS Code profiles should remain disabled with gate, threat-model, and security-review
  metadata;
- browser preview refresh and HTTP(S)-only external handoff through the desktop bridge;
- provider unavailable reasons, MCP health counts, and permission default counts;
- desktop bridge availability and security profile;
- release readiness, blocked public-release gate reasons, and release/update gate state from the packaged manifest;
- renderer process exits, unresponsive/responsive events, and main-frame load failures recorded by the Electron host;
- exported desktop backend logs.

If scheduled automations are owned by the desktop sidecar, closing the app pauses those due runs. Attach mode keeps
scheduled work owned by the attached backend. The app create flow supports daily, weekly, once, and cron schedules and
routes each one through the public scheduled-task contract.

## Known Limitations

- macOS bundles are unsigned and not notarized until release credentials and CI signing are configured.
- Automatic install/restart for updates is disabled; verified downloads are surfaced in Diagnostics once a signed,
  notarized, update-feed-backed release is installed.
- Remote hosts, tunnels, PWA/network exposure, and VS Code embedded surfaces are intentionally disabled pending their
  separate security gates.
- Terminal, browser, and file panes are enabled by default only for trusted local beta surfaces. Constrained or future
  non-local surfaces can disable individual panes through runtime feature policy.
- Browser preview is intended for local development targets and should not be treated as a general-purpose web browser.
