# Start Here

Status: Active
Scope: current-state
Last reviewed: 2026-05-03
Owner: ax-code runtime

If the root [README](../README.md) is the fastest way to install AX Code, this page is the fastest way to understand it.

## What AX Code Is

AX Code is an AI coding runtime. It combines:

- agents for different coding tasks
- explicit tool execution
- model and provider selection
- persistent session state
- configurable isolation and permissions
- integration surfaces such as the TUI, SDK, server mode, and MCP

That matters because AI coding is only useful in real repositories when you can control what the agent is allowed to do, preserve context across sessions, and reuse the same workflow outside a single chat window.

## Where the Value Comes From

- Control. Agents act through explicit tools, permission rules, and isolation modes such as `full-access`, `workspace-write`, or `read-only`.
- Continuity. Sessions can be resumed, forked, compacted, exported, and replayed so long-running work does not disappear when a UI closes.
- Context. `AGENTS.md` lets repository-specific conventions, safety rules, and collaboration defaults live with the code.
- Portability. The same workflow can run against hosted providers or local runtimes without changing the tool surface.
- Extensibility. The same runtime powers the TUI, CLI, VS Code extension, TypeScript SDK, headless server, MCP integrations, and custom tools.

## Mental Model

Think of AX Code as five layers:

1. Provider layer: choose the model backend you want to run against.
2. Agent layer: pick the right agent for the task, or let routing help.
3. Tool layer: the agent acts through explicit tools rather than hidden capabilities.
4. Session layer: the conversation, decisions, and state persist.
5. Control layer: isolation, permissions, and audit behavior define the boundary.

The rest of the documentation maps onto those layers.

## Choose the Next Path

### I want to try it quickly

- Start with the [root README](../README.md) for install and first launch.
- The default package-manager install path uses the compiled runtime:
  - `brew install defai-digital/ax-code/ax-code`
  - `npm i -g @defai.digital/ax-code`
- Use `ax-code-source` only when you intentionally need the source+bun compatibility launcher.
- Use `/connect` or `ax-code providers login` to set a model.
- Run `ax-code init` after opening a real project so `AGENTS.md` captures local conventions.
- If you want tighter safety boundaries, enable [Sandbox Mode](sandbox.md) before broader edits.

### I want to use it safely in a team or company repo

- Read [Sandbox Mode](sandbox.md) for execution boundaries.
- Read [Autonomous Mode](autonomous.md) if the agent will run unattended.
- Read [Security Policy](../SECURITY.md) for threat model and credential storage details.
- Read [Semantic Layer](semantic-layer.md) if provenance and replay matter for your workflow.

### I want to embed or automate it

- Use [`@ax-code/sdk`](../packages/sdk/js/README.md) for in-process TypeScript integration.
- Use [HTTP and OpenAPI SDKs](sdk-http-openapi.md) if you want a service boundary, generated clients, or non-JavaScript integration.
- Use [Project API Spec](specs/project.md) for the current project and session API shape.
- Use `ax-code mcp add` when the agent needs external tools or services.

### I want to understand the repo or contribute feedback

- Read the [Documentation Hub](README.md) for the rest of the public docs.
- Read [CONTRIBUTING.md](../CONTRIBUTING.md) for the current external contribution policy.

## When AX Code May Not Fit

AX Code is intentionally more than autocomplete or a hosted chat box. It may be too much if:

- You only need inline code suggestions and do not want agents executing tools.
- You need a hosted SaaS-only experience with no local runtime.
- You do not need session persistence, replay, SDK/server integration, or repository-level instructions.
- You are working in an environment where no local CLI process is allowed.

In those cases, a lighter editor assistant may be simpler. AX Code is strongest when the agent needs to operate inside real development workflows with control, continuity, and integration boundaries.

## Common First Commands

```bash
ax-code
ax-code providers login
ax-code init
ax-code index
ax-code mcp add
ax-code doctor
```

## Doc Map

| Topic                   | Start here                                                      |
| ----------------------- | --------------------------------------------------------------- |
| Product overview        | [Start Here](start-here.md)                                     |
| Sandbox and permissions | [Sandbox Mode](sandbox.md)                                      |
| Unattended execution    | [Autonomous Mode](autonomous.md)                                |
| Routing and model tier  | [Auto-Route](auto-route.md)                                     |
| SDK embedding           | [`@ax-code/sdk`](../packages/sdk/js/README.md)                  |
| HTTP/OpenAPI clients    | [HTTP and OpenAPI SDKs](sdk-http-openapi.md)                    |
| VS Code integration     | [VS Code integration](../packages/integration-vscode/README.md) |
| Architecture            | [Semantic Layer](semantic-layer.md)                             |
