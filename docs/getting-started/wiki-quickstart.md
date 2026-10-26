# Create and use your first AX Wiki

Status: Active
Scope: current-state
Last reviewed: 2026-10-26
Owner: ax-code runtime

## Before you start

AX Wiki turns selected repository sources into architecture and workflow pages. It is repository knowledge, separate from the AX Code website documentation. [Connect a provider](connect-provider.md) and [choose a usable model](select-model.md) first. Generation sends selected evidence to that provider and may incur usage charges.

Run from your project folder. Git projects use the nearest worktree root, even when you start in a subdirectory. Check your checkout and decide whether generated files belong in version control.

## Preview and generate

The plan previews selected files and pages without a model call. Review it before generation:

```sh
ax-code wiki plan
```

Then generate using the configured model, validate the result and open the local reader:

```sh
ax-code wiki generate
ax-code wiki doctor
ax-code wiki viz --open
```

The default output is `.ax-wiki/`, starting at `.ax-wiki/quickstart.md`; `.ax-wiki/.manifest.json` records sources and hashes. Generation may update the Wiki pointer block in `AGENTS.md`; use `--skip-agents` to skip that step. Review the resulting diff.

## Read and ask useful questions

Start with the quickstart page, follow its cited files and ask where a workflow is implemented. The viewer shows pages, citations and recorded relationships. Stop the foreground CLI viewer with Ctrl+C.

Use Wiki for orientation, then inspect current code and tests. For exact symbols, callers and references use code intelligence or LSP. A fresh page is not proof of complete coverage, correctness or runtime performance.

## Keep it current

After source changes, update affected pages and check health:

```sh
ax-code wiki update
ax-code wiki status
ax-code wiki doctor
```

A missing Wiki can still give a successful status command; check its reported existence and health. Stale or unhealthy output needs investigation. The CLI viewer is a fixed snapshot: reopen it after an update.

In current TUI versions, `/wiki-viz` opens the viewer and requests maintenance. Interactive idle maintenance is enabled by default; foreground work takes priority. Headless runs do not enable that scheduler.

## Control generation

Merge these optional settings into project `ax-code.json`. Replace the model ID with one available through your connection. This example disables background maintenance while retaining explicit commands:

```json
{
  "wiki": {
    "enabled": true,
    "auto": false,
    "model": "provider/model"
  }
}
```

An explicit `--model provider/model` overrides the Wiki model for that invocation. Wiki generation requires recognized low/off reasoning controls for reasoning models; select another supported model if that policy rejects a request.

Maintainer notes belong inside protected blocks so they survive updates:

```markdown
<!-- AX-WIKI:PROTECTED:START project-note -->

Deployment requires maintainer review.

<!-- AX-WIKI:PROTECTED:END -->
```

## Recover from problems

- No model or authentication error: verify provider access and the configured Wiki model. A working chat choice does not guarantee that a separate Wiki model is usable.

- Timeout or interrupted build: inspect `ax-code wiki doctor` and `.ax-wiki/.build-report.json`, then retry after resolving the cause. Validated staged pages may be reused; a failed build does not mean all pages were published.

- Manual-edit conflict: preserve your notes in protected blocks and review changes before retrying. `--force` permits replacement of edits outside protected blocks; use it only intentionally.

## Next steps

[Wiki configuration, CI and troubleshooting](../integrations/wiki.md) · [Viewer and offline export](../guides/wiki-visualization.md) · [Model selection](select-model.md) · [Documentation hub](../README.md)
