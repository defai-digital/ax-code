# AX Code

AX Code is an open-source coding agent for the terminal, SSH, and CI. Connect a
local or hosted model, give the agent a task, then review its changes and the
checks it ran. Session events and available file snapshots let you inspect
earlier steps, compare attempts, and recover changes. Council gathers reviews
from multiple models. Arena can build candidate implementations in isolated Git
worktrees and rank them using your project's checks. You choose which changes
to keep and merge.

[![Latest release](https://img.shields.io/github/v/release/defai-digital/ax-code)](https://github.com/defai-digital/ax-code/releases/latest)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

## Install

The standalone CLI includes the terminal UI and a verified Node.js runtime.

| Platform                        | CLI installation                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| macOS on Apple Silicon          | [Bash installer or Homebrew](docs/getting-started/install-runtime.md#macos-apple-silicon)     |
| Windows AMD64 (x64)             | [PowerShell installer](docs/getting-started/install-runtime.md#windows)                       |
| Ubuntu 24.04+ on amd64 or arm64 | [System dependencies and Bash installer](docs/getting-started/install-runtime.md#ubuntu-2404) |

On Apple Silicon macOS, the standalone installer is available directly:

```bash
curl -fsSL https://download.automatosx.com/ax-code/install | bash
```

See [Installation and Runtime Channels](docs/getting-started/install-runtime.md)
for signature verification, all install commands, and source launchers. The
[AX Code Desktop app](docs/getting-started/install-runtime.md#desktop-installation)
includes its own runtime and has a separate update channel. Source checkouts and
Node.js SDK applications require Node.js 26 or later. For an existing install,
see [Upgrade and recovery](docs/getting-started/upgrade.md).

## First session

Open a terminal in your project and run:

```bash
ax-code
```

Use `/connect` in the TUI or run `ax-code providers login` to
[connect a provider](docs/getting-started/connect-provider.md). Choose a model
with `/model`, ask the agent to inspect your project, then review the diff and
run your project checks after the first edit. Use `ax-code doctor` to diagnose
the CLI installation.

The CLI starts with autonomous mode enabled and `full-access` isolation. For a
session with restricted writes and network access, use
`ax-code --sandbox workspace-write`. See [Sandbox Mode](docs/guides/sandbox.md)
and the [Security Policy](SECURITY.md).

## Models

AX Code supports hosted APIs, vendor CLIs, private GPU endpoints, AX Trust
gateways, and local runtimes. The [provider catalog](docs/providers/supported-providers.md)
lists connection methods and model discovery behavior. Run `ax-code models <provider-id>`
for the exact model IDs available to your installation. If a saved model stops
resolving, run `ax-code doctor` or see [Model recovery](docs/guides/model-recovery.md).

For managed local inference on Apple Silicon, install AX Engine with
`ax-code providers ax-engine install`. Tiel Coder 35B A3B MXFP4 MTP is the
default managed pack. Check [AX Engine Model Selection](docs/providers/ax-engine-model-selection.md)
for supported engine versions, model choices, memory requirements, and
activation checks. To connect a running Ollama, LM Studio, MTPLX, oMLX, AX
Studio, or other OpenAI-compatible endpoint, choose **Local LLM runtime** in
`/connect`. See [local runtime setup](docs/providers/local-mlx-runtimes.md).

## Documentation

| Task                                          | Guide                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Install, connect a provider, or upgrade       | [Start Here](docs/getting-started/start-here.md)                                         |
| Review, compare, replay, or undo an agent run | [Execution Evidence](docs/guides/execution-evidence.md)                                  |
| Verify candidates from multiple models        | [Verified Multi-Model Changes](docs/guides/verified-multi-model-change.md)               |
| Automate with the CLI or embed the runtime    | [Headless CLI](docs/guides/headless-cli.md), [JavaScript SDK](packages/sdk/js/README.md) |
| Connect MCP tools or Chrome                   | [MCP](docs/integrations/mcp.md), [WebMCP](docs/guides/webmcp-bridge.md)                  |
| Build a source-backed project wiki            | [AX Wiki Quickstart](docs/getting-started/wiki-quickstart.md)                            |

Browse the [documentation index](docs/README.md) for configuration, integrations,
and historical benchmarks. See the [changelog](CHANGELOG.md) for release history
and the [editions guide](docs/getting-started/editions.md) for Standard and the
planned Business offering.

## Repository and community

The CLI and runtime are in `packages/ax-code/`, the SDK in
`packages/sdk/js/`, and the Rust workspace in `crates/`. See
[Repository architecture](ARCHITECTURE.md) for the full workspace map and
[Contributing](CONTRIBUTING.md) for source setup and the contribution policy.

Report bugs, request features, or ask questions through [GitHub Issues](https://github.com/defai-digital/ax-code/issues).
Join [Discord](https://discord.gg/gf9UyPxaN2) for community discussion.

## License and provenance

AX Code Standard is maintained by [DEFAI Digital](https://github.com/defai-digital)
and distributed under the [Apache License, Version 2.0](LICENSE). Portions
derived from [OpenCode](https://github.com/anomalyco/opencode),
[OpenTUI](https://github.com/sst/opentui), and
[ax-cli](https://github.com/defai-digital/ax-cli) retain their upstream notices and
[MIT license](LICENSE-MIT). See [NOTICE](NOTICE) for attribution.
