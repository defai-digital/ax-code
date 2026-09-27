# AX Wiki

Status: Active  
Scope: current-state  
Last reviewed: 2026-09-27
Owner: AX Code runtime

AX Wiki is AX Code's native repository-wiki compiler. It turns tracked source, configuration, tests, workflows, and existing documentation into a small source-backed Markdown knowledge base under `ax-wiki/`. It uses the same provider configuration and model routing as AX Code; there is no separate executable or credential store.

## Where it fits

| Need                                                            | Source                                        |
| --------------------------------------------------------------- | --------------------------------------------- |
| Architecture, module responsibilities, workflows, design intent | `ax-wiki/`, starting at `quickstart.md`       |
| Exact symbols, callers, callees, references, refactor impact    | `ax-code index`, `code_intelligence`, and LSP |
| Repository rules, commands, and safety constraints              | `AGENTS.md`                                   |
| Personal preferences and durable decisions                      | `.ax-code/memory.json`                        |

Wiki prose is a compiled navigation layer, not structural proof. If the wiki disagrees with code, trust the code and run `ax-code wiki update`.

## Quick start

Connect an AX Code provider, then run:

```bash
ax-code wiki plan
ax-code wiki generate
ax-code wiki doctor
```

`ax-code init --wiki` generates `AGENTS.md`, inserts the AX Wiki pointer block, and compiles the wiki in one workflow. Use `--wiki-only-agents` to add pointers without model calls.

## Commands

| Command                         | Purpose                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `ax-code wiki plan`             | Preview the deterministic page plan; no model call                           |
| `ax-code wiki generate`         | Compile every planned page                                                   |
| `ax-code wiki update`           | Regenerate only pages affected by source or plan changes                     |
| `ax-code wiki status`           | Show directory, quickstart, manifest, and freshness status                   |
| `ax-code wiki doctor`           | Run status, validation, and knowledge-routing checks                         |
| `ax-code wiki lint`             | Validate metadata, citations, links, protected markers, and source freshness |
| `ax-code wiki ensure-agents`    | Add or update the `AX-WIKI` block in `AGENTS.md` and an existing `CLAUDE.md` |
| `ax-code wiki cards`            | Write the compact `.ax-code/wiki-cards.md` index                             |
| `ax-code wiki related <symbol>` | Find pages by exact frontmatter symbol or body mention                       |

Generation options include `--model provider/model`, `--dir <relative>`, `--quiet`, `--skip-agents`, and `--force`. `--force` is intentionally required to replace generated content manually edited outside protected sections.

## Generated contract

AX Wiki writes Markdown pages and `ax-wiki/.manifest.json`. Each page has frontmatter containing:

- `generated_by: ax-wiki`
- a concise `summary`
- exact `symbols` returned from evidence-backed generation
- the repository-relative `sources` used to compile the page

The manifest stores the deterministic plan hash, repository source hashes, page hashes, generation model, git revision, and generation time. Pages are written atomically; the manifest is written last and only after the complete in-memory candidate passes validation.

Source discovery prefers Git's tracked and unignored file list, excludes generated/build/vendor directories and the wiki itself, skips binary or oversized files, and refuses paths or symlinks outside the repository.

## Subsystem navigation

The default plan keeps quickstart, architecture, and development pages. A module
that exceeds one page's source-count or evidence-byte budget can also receive
focused pages such as `modules/core/src/session.md`. These pages cover direct
subdirectories under the module's `src`, `lib`, or `app` directory, with at least
three code files per subsystem and two eligible subsystems in the module.

Subsystem pages include their implementation subtree and matching files under
the module's `test` or `tests` directory. Their generation instructions request
entry points, runtime flow, boundaries, concrete change locations, and relevant
tests. Module pages place up to two test files immediately after the highest-ranked
source so tests can participate in bounded evidence selection.

The total default budget stays at 12 pages, including the three overview pages.
Module overviews and subsystem pages compete for remaining slots by source count;
a subsystem is included only after its parent overview. Larger subsystems can
therefore displace smaller package pages. Preview the result with `ax-code wiki plan`.
Increase `maxPages` (up to 40 for automatic plans), or configure explicit `pages`
when a particular subsystem needs guaranteed coverage. Explicit plans remain
authoritative and do not receive automatic subsystem pages.

This improves navigation and evidence focus; it does not verify generated prose or
guarantee that an agent reads the wiki. Follow citations back to current source
before relying on implementation details.

## Incremental updates and manual content

`wiki update` compares current source hashes with the manifest and maps changes through each page's selectors. A plan change regenerates all planned pages; otherwise unrelated pages remain untouched.

Generated prose is compiler-owned. Put durable maintainer text inside a protected block:

```markdown
<!-- AX-WIKI:PROTECTED:START deployment-warning -->

Production migrations require an operator-approved maintenance window.

<!-- AX-WIKI:PROTECTED:END -->
```

Protected bodies survive regeneration. AX Wiki refuses to overwrite other manual edits unless `--force` is supplied. Obsolete generated pages are removed only when their managed content is unchanged and they contain no protected section.

## Configuration

Configure the integration in project `ax-code.json`:

```json
{
  "wiki": {
    "enabled": true,
    "auto": true,
    "dir": "ax-wiki",
    "model": "openai/gpt-5-mini",
    "autoInjectAgents": true,
    "touchClaudeMd": true,
    "maxPages": 12,
    "maxSourcesPerPage": 80,
    "exclude": ["fixtures/**"]
  }
}
```

`include`, `exclude`, `maxSourceBytes`, and `maxPageSourceBytes` control evidence discovery and budgets. `instructions` adds project-specific compiler guidance. For a fully curated plan, configure `pages` entries with `path`, `title`, `purpose`, and `selectors`; an explicit plan must include `quickstart.md`.

You can also place compiler guidance in `ax-wiki.instructions.md` and core engine configuration in `ax-wiki.config.json`. Explicit AX Code runtime settings override the core config where both are supplied.

## Default interactive maintenance

Opening a project in the AX Code TUI enables background Wiki maintenance by default.
After 30 seconds of project idle, missing artifacts are generated and stale artifacts
are updated incrementally. Busy/retrying sessions, queued work and a nonempty draft
take priority and cancel background generation. The current agent's read/write
permissions apply; read-only agents do not generate. No agent instruction files are
rewritten by this background workflow.

Use `"wiki": { "auto": false }` to disable background maintenance, or `enabled: false`
to disable compilation and prompt injection. `auto` defaults true and does not write
configuration. It uses the configured Wiki model or the AX Code default model, with
a 10-minute job deadline and up to three automatic attempts with backoff. An explicit
graph request or a source/configuration change allows another attempt. Headless runs
and CI do not enable the interactive scheduler. Non-Git directories require an explicit
request. In Git projects, Wiki generation and consumption use the nearest worktree
root, so opening AX Code in a package does not create a separate package Wiki.

The session sidebar and `/wiki-viz` open a local progress page immediately and request
maintenance. Once a snapshot is ready, that page shows recorded Wiki page/source
relationships. See [Wiki visualization](../guides/wiki-visualization.md).

## Agent routing

When a healthy wiki exists and `wiki.enabled` is not `false`, session prompts receive a compact `<repo_wiki>` protocol. It tells agents to start at quickstart, load only relevant pages, verify important claims through cited files, and use graph/LSP tools for structural questions.

`healthy` describes the presence of the wiki directory, index, and manifest. The separate `freshness` field is
`fresh`, `stale`, or `unknown`. Status and session routing compare current source hashes using the effective
include/exclude and size settings, so uncommitted edits, additions, and deletions are detected. Checks do not reuse
a cached fresh verdict; they scan eligible sources with bounded read concurrency. Missing or disabled wikis avoid
the source scan. Freshness is a point-in-time source check, not validation of every generated claim or page; use lint
for artifact validation.

Stale or unverified wikis remain available for navigation, with an explicit instruction to verify current original
source before relying on implementation claims. Verification errors produce `unknown`. `wiki status` exits 0 when no
wiki directory exists (the missing wiki is the report). When a wiki is present, it exits unsuccessfully if the wiki is
unhealthy or freshness is not `fresh`.

Wiki evidence is bounded: each selected source contributes at most its first 32,000 bytes within the page budget,
with truncation marked for the generator. GraphContext can add selected snippets, but each snippet is limited to
80 lines. These navigation aids do not guarantee preservation of every changed function or required guard; provide
the necessary original code separately for a scoped review.

The managed `<!-- AX-WIKI:START -->` block in `AGENTS.md` carries the same routing policy without copying wiki content into repository instructions.

## CI

Run `ax-code wiki update` followed by `ax-code wiki lint` in a provider-authenticated job, then open a documentation PR. See [`examples/ax-wiki-update.yml`](../examples/ax-wiki-update.yml). Treat generated wiki changes like other documentation: review source citations and avoid auto-merging model output.

## Troubleshooting

| Symptom                                    | Action                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| No model or authentication error           | Connect/configure an AX Code provider or pass `--model provider/model`       |
| `manually modified generated pages`        | Move durable text into protected markers, or review and rerun with `--force` |
| Wiki is stale                              | Run `ax-code wiki update`, then `ax-code wiki lint`                          |
| Missing/broken page or citation            | Run `ax-code wiki generate`; inspect custom page selectors if configured     |
| Architecture answer needs exact references | Use `code_intelligence` or LSP; the wiki is conceptual navigation            |
