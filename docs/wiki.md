# AX Wiki

Status: Active  
Scope: current-state  
Last reviewed: 2026-07-18

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

## Agent routing

When a healthy wiki exists and `wiki.enabled` is not `false`, session prompts receive a compact `<repo_wiki>` protocol. It tells agents to start at quickstart, load only relevant pages, verify important claims through cited files, and use graph/LSP tools for structural questions.

The managed `<!-- AX-WIKI:START -->` block in `AGENTS.md` carries the same routing policy without copying wiki content into repository instructions.

## CI

Run `ax-code wiki update` followed by `ax-code wiki lint` in a provider-authenticated job, then open a documentation PR. See [`examples/ax-wiki-update.yml`](examples/ax-wiki-update.yml). Treat generated wiki changes like other documentation: review source citations and avoid auto-merging model output.

## Troubleshooting

| Symptom                                    | Action                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| No model or authentication error           | Connect/configure an AX Code provider or pass `--model provider/model`       |
| `manually modified generated pages`        | Move durable text into protected markers, or review and rerun with `--force` |
| Wiki is stale                              | Run `ax-code wiki update`, then `ax-code wiki lint`                          |
| Missing/broken page or citation            | Run `ax-code wiki generate`; inspect custom page selectors if configured     |
| Architecture answer needs exact references | Use `code_intelligence` or LSP; the wiki is conceptual navigation            |
