# AX Code

[![Latest release](https://img.shields.io/github/v/release/defai-digital/ax-code)](https://github.com/defai-digital/ax-code/releases/latest)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

AX Code is an open-source coding agent for the terminal, SSH, and CI. Connect a
local or hosted model, give the agent a task, then review its changes and the
checks it ran before you keep anything.

- **Evidence you can inspect.** Session events and file snapshots let you
  review earlier steps, compare attempts, and recover changes.
- **Multi-model review.** Council gathers reviews from several models. Arena
  builds candidate implementations in isolated Git worktrees and ranks them
  with your project's own checks.
- **Any model.** Hosted APIs, vendor CLIs, private GPU endpoints, AX Trust
  gateways, and local runtimes, including managed AX Engine on Apple Silicon.
- **You decide.** AX Code ranks and reports; you choose which changes to merge.

## Install

The standalone CLI includes the terminal UI and a verified Node.js runtime.

| Platform                        | CLI installation                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| macOS on Apple Silicon          | [Bash installer or Homebrew](docs/getting-started/install-runtime.md#macos-apple-silicon)     |
| Windows AMD64 (x64)             | [PowerShell installer](docs/getting-started/install-runtime.md#windows)                       |
| Ubuntu 24.04+ on amd64 or arm64 | [System dependencies and Bash installer](docs/getting-started/install-runtime.md#ubuntu-2404) |

On Apple Silicon macOS:

```bash
curl -fsSL https://download.automatosx.com/ax-code/install | bash
```

[Installation and Runtime Channels](docs/getting-started/install-runtime.md)
covers every platform command, signature verification, and source launchers.
To update an existing install, see [Upgrade and recovery](docs/getting-started/upgrade.md).
The [AX Code Desktop app](docs/getting-started/install-runtime.md#desktop-installation)
bundles its own runtime and updates separately from the CLI.

Source checkouts and Node.js SDK applications require Node.js 26 or later.

## Quick start

1. Open a terminal in your project and run `ax-code`.
2. Use `/connect` in the TUI, or run `ax-code providers login`, to
   [connect a provider](docs/getting-started/connect-provider.md).
3. Choose a model with `/model` ([model selection](docs/getting-started/select-model.md)).
4. Ask the agent to inspect the project or make one small change.
5. Review the diff and run your project checks before committing.

Run `ax-code init` to record repository conventions in `AGENTS.md`, and
`ax-code doctor` to diagnose the installation or a saved model that no longer
resolves.

## Safety defaults

The CLI starts with autonomous mode enabled and `full-access` isolation. For a
session with restricted writes and network access, use
`ax-code --sandbox workspace-write`. Read [Sandbox Mode](docs/guides/sandbox.md),
[Autonomous Mode](docs/guides/autonomous.md), and the
[Security Policy](SECURITY.md) before running the agent on team, untrusted, or
unattended work.

## Models

- **Hosted, CLI, and gateway providers:** the
  [provider catalog](docs/providers/supported-providers.md) lists connection
  methods and model discovery. Run `ax-code models <provider-id>` for the exact
  model IDs available to your installation.
- **Managed local inference (Apple Silicon):** run
  `ax-code providers ax-engine install`. See
  [AX Engine Model Selection](docs/providers/ax-engine-model-selection.md) for
  supported models, memory requirements, and activation checks.
- **Other local runtimes:** for Ollama, LM Studio, MTPLX, oMLX, AX Studio, or any
  OpenAI-compatible endpoint, choose **Local LLM runtime** in `/connect`. See
  [local runtime setup](docs/providers/local-mlx-runtimes.md).
- **Free evaluation:** see the [Free-Tier API Quickstart](docs/providers/free-tier-apis.md).

## Documentation

| I want to…                                    | Guide                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Understand the product and pick a workflow    | [Start Here](docs/getting-started/start-here.md)                                         |
| Review, compare, replay, or undo an agent run | [Execution Evidence](docs/guides/execution-evidence.md)                                  |
| Get several models to attempt or review work  | [Verified Multi-Model Changes](docs/guides/verified-multi-model-change.md)               |
| Run unattended, in CI, or on a schedule       | [Headless CLI](docs/guides/headless-cli.md), [Loop Mode](docs/guides/loop-mode.md)       |
| Embed the runtime in an application           | [JavaScript SDK](packages/sdk/js/README.md), [HTTP and OpenAPI](docs/sdk/http-openapi.md) |
| Connect MCP tools or Chrome                   | [MCP](docs/integrations/mcp.md), [WebMCP](docs/guides/webmcp-bridge.md)                  |
| Build a source-backed project wiki            | [AX Wiki Quickstart](docs/getting-started/wiki-quickstart.md)                            |

The [documentation index](docs/README.md) lists every guide. Release history is
in the [changelog](CHANGELOG.md); licensing and the planned Business offering
are described in [Standard and Business](docs/getting-started/editions.md).

## Repository

| Path               | Contents                                     |
| ------------------ | -------------------------------------------- |
| `packages/ax-code` | CLI, TUI, HTTP server, and agent runtime     |
| `packages/sdk/js`  | JavaScript/TypeScript SDK and OpenAPI client |
| `packages/ax-tui`  | Terminal UI framework                        |
| `crates/`          | Rust workspace for native addons             |
| `docs/`            | Public user documentation                    |

See [Repository architecture](ARCHITECTURE.md) for the full workspace map and
[Contributing](CONTRIBUTING.md) for source setup and the contribution policy.

## Community

Report bugs, request features, or ask questions through
[GitHub Issues](https://github.com/defai-digital/ax-code/issues). Join
[Discord](https://discord.gg/gf9UyPxaN2) for community discussion. Report
vulnerabilities as described in the [Security Policy](SECURITY.md).

## License and provenance

AX Code Standard is maintained by [DEFAI Digital](https://github.com/defai-digital)
and distributed under the [Apache License, Version 2.0](LICENSE). Portions
derived from [OpenCode](https://github.com/anomalyco/opencode),
[OpenTUI](https://github.com/sst/opentui), and
[ax-cli](https://github.com/defai-digital/ax-cli) retain their upstream notices and
[MIT license](LICENSE-MIT). See [NOTICE](NOTICE) for attribution.
