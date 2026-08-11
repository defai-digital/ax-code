# Review Protocol — desktop-docs

## Step 1 Scope and inventory

The `desktop-docs` unit is rooted at `desktop/packages/docs`, as declared by `docs/module-quality-audit/modules/desktop-docs/MODULE-AUDIT.md:5-7`. The checked-in inventory is stale: its `0 / 0` claim at `MODULE-AUDIT.md:17` conflicts with the actual tree of 40 files and 1,730 lines. `desktop/packages/docs/README.md:3-10` identifies the package as the public documentation source of truth and names its MDX content, sidebar, authoring guide, and deployment guide. The review covered all 36 MDX pages, the three top-level Markdown files, and `sidebar.config.json`; related validator, workflow, runtime-default, UI-availability, and test files were opened where documentation claims required implementation evidence.

## Step 2 Trust and failure boundaries

The highest-impact asset is accurate safety guidance for a local service with broad machine and source access (`desktop/packages/docs/content/docs/security.mdx:8-10`). The reviewed boundary text correctly limits both servers to loopback and warns against proxies and tunnels (`security.mdx:30-37`). Credential-bearing guidance uses names or placeholders rather than live values: `environment.mdx:20-22,82-84` describes password/JWT inputs, `ax-code-server.mdx:57-63` explains service environment snapshots, and `DEPLOYMENT.md:31-37` names a repository token without exposing one. The Linux install page contains trust-sensitive `curl | bash` and `sudo apt install` commands at `install.mdx:60-69`; these are visible user actions, but the local validator does not authenticate external targets or release signatures. No Critical secret disclosure or unsafe remote-bind instruction was found.

## Step 3 Accuracy and behavioral consistency

Several claims have drifted from the implementation. The browser UI default is 3100 in `packages/ax-code/src/desktop/webui.ts:9`, `desktop/packages/web/server/index.js:69`, and the correct troubleshooting entry at `desktop/packages/docs/content/docs/troubleshooting.mdx:19`, but `CONTRIBUTING.md:38` and `troubleshooting/ax-code-connection.mdx:29` still direct readers to port 3000. The same troubleshooting pages require Node 20 at `troubleshooting.mdx:12` and `troubleshooting/ax-code-connection.mdx:27`, while `package.json:13-15`, `desktop/README.md:260`, and `desktop/packages/web/README.md:12` require Node 24. `project-actions.mdx:24` advertises an SSH-forward route even though `remote-instances.mdx:8` says forwarding is unavailable and `desktop/packages/ui/src/lib/settings/metadata.ts:77-84` hard-disables that page. Finally, `notes-todos-plans.mdx:28-29` splits “file” across two lines and renders broken prose.

## Step 4 Cost and scale review

This unit is static content, so there is no request-time loop, cache, process lifetime, or retained state in scope. The validator recursively enumerates directories with `Promise.all` at `desktop/scripts/docs/validate-docs.mjs:15-25`, then reads and checks each of the 36 MDX pages once at lines 68-89. Sidebar verification is linear in its 32 links at lines 102-109. That is proportionate for the present 1,730-line corpus, and no performance defect is supported. The missing publication automation discussed below is an availability and ownership problem, not a throughput problem.

## Step 5 Ownership and release design

The intended separation is explicit: this repository owns content, while a downstream `apps/docs` repository renders it (`desktop/packages/docs/README.md:25-32`). The operational contract no longer matches the repository. `DEPLOYMENT.md:9-29` promises `.github/workflows/docs-source.yml`, packaging, dispatch, and automatic site updates, but that workflow is absent; the current Desktop release workflow only runs `node desktop/scripts/docs/validate-docs.mjs` during preflight (`.github/workflows/desktop-release.yml:52-64`). Likewise, `CONTRIBUTING.md:84-108,197-198` uses nonexistent `packages/docs/...` paths instead of `desktop/packages/docs/...`. These ownership seams make the maintainer workflow non-executable even though the content architecture itself remains simple.

## Step 6 Maintenance hygiene and reachability

A scan found no TODO/FIXME/HACK markers or executable MDX script blocks in the package. All pages carry title and description frontmatter, and all 32 sidebar destinations resolve. Four policy pages—`cloudflare-tunnel.mdx`, `remote-instances.mdx`, `reverse-proxy.mdx`, and `troubleshooting/remote-access.mdx`—have neither a sidebar entry nor an incoming internal link; compare the Security sidebar's sole `/security/` item at `sidebar.config.json:110-117` with their standalone policy notices at `cloudflare-tunnel.mdx:8-14`, `remote-instances.mdx:8-10`, and `reverse-proxy.mdx:8-10`. They may be intentional legacy landing pages, but their direct-URL-only status should be documented or tested. The broken “fil”/“e” wrap at `notes-todos-plans.mdx:28-29` is a definite low-severity cleanup item.

## Step 7 Test and validator coverage

The audit manifest lists four adjacent test files at `MODULE-AUDIT.md:31-35`; the focused run passed all four files and all 25 tests. Those suites largely cover Desktop handoff, Web UI discovery, release mechanics, and unrelated public safety docs. The unit-specific validator is the strongest direct check: `validate-docs.mjs:43-47,69-109` checks frontmatter, four policy regexes, and sidebar targets, and it passed with 36 pages and 32 links. Its blind spots explain the observed drift: it does not resolve every inline internal link, spell-check prose, compare ports or Node floors to runtime constants, confirm documented package scripts exist, or assert that the named publishing workflow exists.

## Step 8 Finding dispositions

No `findings/` files exist, and the existing register says no accepted finding at `MODULE-AUDIT.md:49-53`. This pass records one High documentation-operations issue: `README.md:14-18`, `CONTRIBUTING.md:100-104,185-189`, and `DEPLOYMENT.md:9-29` direct maintainers to a nonexistent `docs:validate` package script and absent publishing workflow; the documented command fails with “Script not found”. Two Medium accuracy issues remain: stale Node/port troubleshooting (`troubleshooting.mdx:12,19` and `troubleshooting/ax-code-connection.mdx:27-29`) and the unavailable SSH-forward claim (`project-actions.mdx:24`). The split word at `notes-todos-plans.mdx:28-29` is Low, and the four unlinked legacy-policy pages are informational pending an explicit retention decision. None is Critical, so `protocol/reverify.md` is intentionally not created.

## Step 9 Verification and exit assessment

`node desktop/scripts/docs/validate-docs.mjs` passed with “36 pages, 32 sidebar links.” The docs' own `bun run docs:validate` command failed with “Script not found,” independently confirming the High workflow drift. `AX_TEST_FILES=test/cli/tui/desktop-handoff.test.ts,test/desktop/webui.test.ts,test/script/desktop-release-workflow.test.ts,test/script/docs-safety-contract.test.ts pnpm --dir packages/ax-code exec vitest run` passed 4 files and 25 tests. Targeted `rg` checks confirmed the actual 3100 defaults, Node 24 requirements, disabled Remote Instances metadata, absent publishing workflow, unlinked legacy routes, and lack of TODO-style debt. The nine-step primary review is complete for lane `codex-sol`; verifier assignment remains `ax-code-glm`.
