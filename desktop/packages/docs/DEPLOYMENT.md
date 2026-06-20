# Docs Source Deployment

This repo publishes docs **source artifacts**.

Rendering and hosting happen in the downstream docs website (`apps/docs`).

## Workflow

Use `.github/workflows/docs-source.yml`.

Triggers:

- push to `main` when docs source changes
- release published
- manual `workflow_dispatch`

Outputs:

- validates docs (`bun run docs:validate`)
- creates `openchamber-docs-source-<sha>.tar.gz`
- uploads archive as workflow artifact
- on release/manual with tag, uploads archive to release assets

## Cross-repo sync trigger

After validating and packaging, the workflow sends a `repository_dispatch` event
to the downstream docs website so it re-syncs and redeploys the docs. This fires on
**every** trigger above — push to `main` (docs changes), release, and manual
`workflow_dispatch` — so a normal commit to docs auto-updates the live site.

Required secret in this repo:

- `AX_CODE_DESKTOP_WEBSITE_REPO_TOKEN` — a token with `contents: write` (classic
  `repo` scope, or fine-grained with Contents: read & write) on the downstream
  docs website repository. **Without it the dispatch step is skipped**
  (it logs "not set" and exits cleanly), so the site will never auto-update.
  This is the most common reason the pipeline silently does nothing.

Event sent:

- `event_type: docs_source_updated`

Payload includes:

- `source_repo`
- `source_ref` — the ref the website checks out from this repo (`main` on a
  push, the tag on a release)
- `archive_name`

The downstream website's `deploy-docs.yml` listens for this event
(`repository_dispatch: types: [docs_source_updated]`), checks out
this repo at `source_ref`, runs `docs:sync`, builds `apps/docs`, and deploys
to the configured static hosting provider. That repo needs its own
`AX_CODE_DESKTOP_REPO_TOKEN` secret with read access to this repo, plus any
provider-specific deployment secrets.
