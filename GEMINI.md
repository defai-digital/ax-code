# AX Code - Project Context

AX Code is an AI coding runtime and execution engine designed for teams that need control, auditability, and extensibility. It combines agents, tool execution, provider routing, and configurable isolation into a single system.

## Project Overview

- **Core Purpose**: An AI execution runtime for software development that runs in the terminal (TUI/CLI), VS Code, or as a headless server.
- **Main Technologies**:
  - **Runtime**: [Bun](https://bun.sh) (primary orchestration and CLI/TUI).
  - **Languages**: TypeScript, Rust (for performance-critical operations).
  - **Frameworks**: SolidJS (via OpenTUI for the TUI), Drizzle ORM (for SQLite persistence).
  - **Native Interop**: [NAPI-RS](https://napi.rs) for TypeScript/Rust integration.
  - **AI Integration**: Vercel AI SDK, supporting Anthropic, OpenAI, Google Gemini, and xAI.

## Repository Structure

The project is a **pnpm workspace** monorepo:

- `packages/ax-code`: Main CLI, TUI, server, and core backend logic.
- `packages/ui`: Shared UI components and visual infrastructure (SolidJS).
- `packages/util`: Shared utilities with minimal dependencies.
- `packages/sdk/js`: Programmatic and HTTP SDK.
- `packages/integration-vscode`: VS Code extension.
- `crates/`: Rust native addons for performance-critical tasks (indexing, diffing, parsing).
- `docs/`: Product-facing documentation, architecture policies, and specs.

## Building and Running

### Prerequisites

- **Bun**: v1.3.13+
- **pnpm**: v9.15.9+
- **Rust/Cargo**: For native component builds.

### Key Commands

- **Install Dependencies**: `pnpm install`
- **Setup Local CLI**: `pnpm run setup:cli` (Links the `ax-code` command to your local source).
- **Build Native Components**: `pnpm run build:native`
- **Run in Development**: `pnpm dev` or `bun packages/ax-code/src/index.ts`
- **Typecheck**: `pnpm run typecheck`
- **Run Tests**:
  - Root: `pnpm -r test` (though root `package.json` suggests running from packages).
  - Core: `cd packages/ax-code && bun test`
  - Grouped tests: `bun run test:unit`, `bun run test:e2e`, `bun run test:deterministic`.

## Development Conventions

- **File Scope**: Preferred file size is under 300 lines. Files exceeding 500 lines are flagged for review, and 800+ lines generally require splitting.
- **Layering**:
  - Business logic lives in domain folders (e.g., `session`, `project`, `provider`).
  - `ax-code` must not depend on `ui` (clean separation of runtime and presentation).
- **Testing**:
  - `packages/ax-code` uses a mirrored `test/` tree for integration coverage.
  - Shared packages colocate tests near the source.
- **Documentation**: Use `docs/` for public-facing content and internal planning folders for development-stage docs.
- **Persistence**: Uses SQLite for session state, replay, and project context.

## Core Features for AI Agents

- **Controlled Execution**: Configurable sandbox and permissions (`full-access`, `workspace-write`, `read-only`).
- **Semantic Layer**: Provenance and replay boundaries for code intelligence.
- **MCP Support**: Extensible via Model Context Protocol (MCP) servers.
- **Persistent Sessions**: Sessions can be resumed, forked, and audited.
- **AGENTS.md**: Captures project-specific instructions and conventions for the runtime.
