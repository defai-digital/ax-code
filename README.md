```
___________  __     _________________________________
___    |_  |/ /     __  ____/_  __ \__  __ \__  ____/
__  /| |_    /_______  /    _  / / /_  / / /_  __/
_  ___ |    |_/_____/ /___  / /_/ /_  /_/ /_  /___
/_/  |_/_/|_|       \____/  \____/ /_____/ /_____/
```

**A local-first agent runtime for serious software work.**

AX Code runs coding agents against your actual repositories through a terminal TUI, one-shot CLI, VS Code, a TypeScript SDK, and a local HTTP server. It is built around durable sessions, explicit tools, sandboxed execution, provider routing, code intelligence, and MCP/plugin extensibility so teams can let agents act without losing control of the work.

- Work interactively in the terminal with model, provider, agent, session, MCP, and skill controls
- Run headless tasks for scripts, CI, bots, and internal automation with the same runtime
- Preserve work with persistent sessions, replay, fork, export, compare, rollback, and repo instructions in `AGENTS.md`
- Bound execution with `workspace-write`, `read-only`, or `full-access` isolation plus permission rules
- Extend with MCP servers, plugins, custom agents, Agent Skills, SDK tools, and VS Code integration

Built by [DEFAI Digital](https://github.com/defai-digital).

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/cTavsMgu)

---

## Get Started in 20 Seconds

**1. Install**

| Platform | Command |
| --- | --- |
| macOS | `brew install defai-digital/ax-code/ax-code` |
| Linux / CI | `curl -fsSL https://raw.githubusercontent.com/defai-digital/ax-code/main/install \| bash` |
| Windows | `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/defai-digital/ax-code/main/install.ps1 \| iex"` |

**2. Run**

```bash
ax-code
```

No project setup or config file required. On first launch, use `/connect` inside the TUI to add a provider.

For headless use, CI jobs, or preconfigured shells, AX Code also respects provider environment variables such as `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY`, and `OPENAI_API_KEY`.

### Update

`ax-code upgrade` and package-manager update commands apply to the compiled runtime shipped by supported installers.

```bash
ax-code upgrade
brew upgrade ax-code
curl -fsSL https://raw.githubusercontent.com/defai-digital/ax-code/main/install | bash
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/defai-digital/ax-code/main/install.ps1 | iex"
```

### Distribution note

Supported user install paths are Homebrew, the GitHub release installer for Linux/CI, and the GitHub release installer for Windows PowerShell. For security-sensitive environments, download and inspect the installer before running it:

```bash
curl -fsSL https://raw.githubusercontent.com/defai-digital/ax-code/main/install -o ax-code-install
less ax-code-install
bash ax-code-install
```

```powershell
irm https://raw.githubusercontent.com/defai-digital/ax-code/main/install.ps1 -OutFile ax-code-install.ps1
Get-Content .\ax-code-install.ps1
.\ax-code-install.ps1
```

Use `--version <release>` on Linux/CI or `-Version <release>` on Windows when the installed version must be pinned.

npm packages, including the former source compatibility package, are no longer supported as install or upgrade channels.

See [Installation and Runtime Channels](docs/install-runtime.md) for the full package, runtime-label, and local launcher matrix.

### From Source (contributors)

```bash
git clone https://github.com/defai-digital/ax-code.git
cd ax-code && pnpm install && pnpm run setup:cli
```

Requires [pnpm](https://pnpm.io) v10.33.4+ and [Bun](https://bun.sh) matching the root `package.json` engine (`^1.3.14` today). `setup:cli` installs a launcher for the same bundled runtime used by Homebrew and the GitHub release installer. `ax-code doctor` should report `Runtime: Bun X.Y.Z (compiled)`.

Refresh the local bundled runtime after code changes:

```bash
pnpm --dir packages/ax-code run build -- --single
pnpm run setup:cli -- --rebuild
ax-code doctor
```

For contributor-only source debugging, install the checkout-bound launcher explicitly:

```bash
pnpm run setup:cli -- --source
```

That source launcher should report `Runtime: Bun X.Y.Z (source)` and is intentionally separate from the default compiled/bundled launcher.

---

## What AX Code Does

AX Code is designed for agent work that touches real files, shells, sessions, and team policy. The same runtime powers every surface:

| Need                         | Use                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| Interactive coding           | `ax-code` opens the terminal UI with provider, model, agent, session, MCP, and skill flows   |
| One-shot automation          | `ax-code run "review the auth flow"` runs a bounded headless task                            |
| Local service / integrations | `ax-code serve` exposes the runtime over a local HTTP API and OpenAPI contract               |
| TypeScript embedding         | `@ax-code/sdk` provides `createAgent()`, streaming events, sessions, custom tools, and tests |
| VS Code                      | The VS Code integration uses the installed CLI/server while staying editor-native            |

## Current Capabilities

- **Terminal command center**: prompt editing, provider/model picker, agent picker, session list, MCP status, skill dialog, sandbox/autonomous toggles, and live tool progress.
- **Controlled execution**: tools such as read, edit, write, grep, glob, bash, web fetch/search, todo, task, and skill execution all pass through permission and isolation boundaries.
- **Durable sessions**: resume, fork, compact, export/import, replay, compare, rollback, and inspect session risk instead of losing work when a chat closes.
- **Repository intelligence**: `ax-code init` writes `AGENTS.md`; `ax-code index`, `graph`, semantic diff, LSP-backed context, and risk/DRE views help agents reason over larger codebases.
- **Provider flexibility**: connect hosted or local providers from `/connect` or `ax-code providers login`; list available models with `ax-code models`.
- **Extensibility**: add MCP servers, create custom agents, validate Agent Skills, and embed custom SDK tools without rebuilding the orchestration layer.

## Control Model

AX Code starts with autonomous mode on and runtime isolation in `workspace-write` by default: network is disabled, writes stay inside the workspace, and protected paths such as `.git/` and `.ax-code/` remain blocked. The agent can make progress without asking about every low-risk step, while the sandbox still enforces the boundary.

- Use `/sandbox`, `--sandbox read-only`, `--sandbox workspace-write`, or `--sandbox full-access` to change isolation intentionally.
- Use `/autonomous` or `AX_CODE_AUTONOMOUS=false` when you want the agent to stop for each permission or question.
- Use `ax-code mcp list --tools`, `ax-code mcp trust`, and permission rules to control external MCP tool surfaces.
- Provider and MCP credentials are encrypted at rest; server mode is localhost-only by default.

See [Sandbox Mode](docs/sandbox.md), [Autonomous Mode](docs/autonomous.md), [MCP Integrations](docs/mcp.md), and [SECURITY.md](SECURITY.md) for the full control model.

## Typical Workflow

1. Open a repository and run `ax-code`.
2. Use `/connect` to add a provider or switch models. For automation, use `ax-code providers login` or provider environment variables.
3. Run `ax-code init` so `AGENTS.md` captures local conventions, safety rules, and project context.
4. Keep the default sandbox for broad edits; change it only when the task needs a different boundary.
5. Run `ax-code index` on larger repos when semantic search and code-intelligence workflows matter.
6. Use `ax-code run`, `ax-code serve`, or `@ax-code/sdk` when the same agent workflow needs to move into scripts, CI, bots, or applications.

Grok is exposed as two separate provider plans in `/connect`: `Grok Cloud API` uses `XAI_API_KEY` and hosted xAI models, while `Grok Build CLI` uses the local `grok` command and its CLI login/session.

## Documentation

- [Start Here](docs/start-here.md): understand what AX Code is, where the value comes from, and which docs to read next
- [Documentation Hub](docs/README.md): guides, architecture, specs, and reference docs
- [Sandbox Mode](docs/sandbox.md): isolation modes, protected paths, and network controls
- [Autonomous Mode](docs/autonomous.md): unattended execution behavior and safeguards
- [MCP Integrations](docs/mcp.md): trust, permissions, and prompt/resource safety for MCP servers
- [Auto-Route](docs/auto-route.md): keyword-based specialist routing and optional fast-model complexity routing
- [Semantic Layer](docs/semantic-layer.md): provenance and replay boundaries for graph and LSP-backed answers

## Common Commands

| Command                                        | Purpose                                      |
| ---------------------------------------------- | -------------------------------------------- |
| `ax-code`                                      | Open the interactive terminal UI             |
| `ax-code run "debug why the build is failing"` | Run a one-shot headless task                 |
| `ax-code providers login`                      | Configure provider credentials               |
| `ax-code models`                               | List available provider/model IDs            |
| `ax-code init`                                 | Create or update repository `AGENTS.md`      |
| `ax-code index`                                | Build code-intelligence indexes              |
| `ax-code graph`                                | Inspect the repository graph                 |
| `ax-code mcp list --tools`                     | Review MCP servers, exposed tools, and rules |
| `ax-code mcp add`                              | Add a local or remote MCP server             |
| `ax-code agent create`                         | Generate a custom project or global agent    |
| `ax-code skill list`                           | List discovered Agent Skills                 |
| `ax-code serve`                                | Start the local HTTP/OpenAPI server          |
| `ax-code doctor`                               | Diagnose install, runtime, storage, and auth |

## Community

Report bugs, feature requests, and questions through [GitHub Issues](https://github.com/defai-digital/ax-code/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) for the current contribution policy and [Discord](https://discord.gg/cTavsMgu) for community discussion.

## License

[MIT](LICENSE) — Copyright (c) 2025 [DEFAI Private Limited](https://github.com/defai-digital). Portions derived from [OpenCode](https://github.com/anomalyco/opencode), Copyright (c) 2025 opencode.
