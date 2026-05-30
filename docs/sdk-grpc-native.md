# gRPC and Native SDK Transport

Status: Active
Scope: desktop-native transport contract
Last reviewed: 2026-05-30
Owner: ax-code sdk

AX Code now exposes an optional gRPC-shaped transport contract for desktop and native GUI apps. The contract is intentionally narrower than the full HTTP/OpenAPI route tree: it focuses on the headless runtime capabilities a GUI needs to feel native, while keeping HTTP/OpenAPI available for compatibility, diagnostics, and generated clients.

## Recommendation

Use gRPC/native transport as the preferred boundary for first-party desktop apps. Keep HTTP/SSE enabled as the fallback and debug surface.

| Need                                           | Recommended path                         | Reason                                                                                 |
| ---------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| First-party desktop GUI                        | `@ax-code/sdk/grpc`                      | Stable command/event contract, streaming-ready, native-friendly metadata and deadlines |
| TypeScript automation in the same process      | `@ax-code/sdk` with `createAgent()`      | Lowest overhead and custom tool support                                                |
| Browser, WebView fallback, or easy diagnostics | HTTP/SSE with `@ax-code/sdk/headless`    | Works with fetch, curl, browser devtools, and current server auth controls             |
| External non-JS integrations                   | OpenAPI-generated HTTP client            | Broad tooling support and no first-party maintenance commitment per language           |
| Rust host embedding                            | gRPC/native service or subprocess bridge | Avoids exposing the full HTTP route tree to the app shell                              |

## Why Not Remove HTTP

Removing HTTP/OpenAPI would reduce one exposed surface, but it would also remove the most inspectable and portable integration path. Current HTTP server controls already include loopback-first defaults, required password for non-loopback binds, Basic Auth, origin checks on mutating browser requests, directory validation, request rate limits, and loopback-only live OpenAPI docs by default.

The transport is not the dominant latency source for normal agent turns. LLM calls, shell commands, file IO, indexing, LSP startup, and tool execution are usually more expensive than localhost JSON. gRPC is still useful for a desktop GUI because it provides a cleaner native API contract, deadlines, metadata, server streaming, and a path to Unix-socket or named-pipe transports without dragging a browser-oriented API into the app shell.

## Contract Shape

The language-neutral contract lives at [`packages/sdk/proto/ax_code/v1/headless.proto`](../packages/sdk/proto/ax_code/v1/headless.proto).

The TypeScript facade lives at `@ax-code/sdk/grpc` and covers:

- health and lifecycle readiness
- session creation
- prompt, command, shell, abort, permission reply, and question reply
- GUI bootstrap snapshots for providers, sessions, permissions, questions, path, VCS, LSP, MCP, formatter, and command state
- session list, detail, message history, message detail, children, goal, todo, diff, fork, share, and summarize operations
- GUI discovery and workspace navigation for agents, skills, projects, file tree/content/status, text/file/symbol search, and tool schemas
- provider, config, API-key auth, and provider OAuth settings for GUI settings screens
- PTY terminal management and bidirectional terminal streaming
- session evidence for review/debug UI
- task queue operations
- scheduled task operations
- workflow templates, workflow runs, workflow routines, and run artifacts
- server-streamed runtime events

The proto uses structured JSON payloads for command bodies and workflow/task payloads. That keeps the transport stable while AX Code runtime schemas continue to evolve quickly.

## TypeScript Usage

Use the HTTP bridge while the native gRPC server is being implemented:

```ts
import { startHeadlessBackend } from "@ax-code/sdk/headless"
import { createAxCodeGrpcClientFromHttp, createAxCodeGrpcClientFromNativeBridge } from "@ax-code/sdk/grpc"

const backend = await startHeadlessBackend({ directory: "/workspace/app" })
try {
  const client = createAxCodeGrpcClientFromHttp({
    baseUrl: backend.url,
    headers: backend.headers,
    directory: "/workspace/app",
  })

  const session = await client.createSession({ title: "GUI session" })
  const messages = await client.session.messages((session as { id: string }).id, { limit: 50 })
  const skills = await client.app.skills()
  const readme = await client.file.read("README.md")
  const authMethods = await client.provider.auth()
  const bootstrap = await client.bootstrap.load({
    include: { sessions: true, providers: true, providerList: true, path: true, vcs: true },
  })
  const terminal = (await client.pty.create({ title: "GUI shell" })) as { id: string }

  await client.sendPrompt((session as { id: string }).id, {
    parts: [{ type: "text", text: "Review this workspace" }],
  })

  for await (const event of client.subscribeEvents()) {
    if (event.type === "server.heartbeat") continue
    // Project event into GUI state.
  }
} finally {
  await backend.close()
}
```

Use a native bridge when the desktop host owns the privileged runtime boundary:

```ts
const client = createAxCodeGrpcClientFromNativeBridge({
  unary(call) {
    return window.axCodeNative.unary(call)
  },
  serverStream(call) {
    return window.axCodeNative.serverStream(call)
  },
  bidiStream(call) {
    return window.axCodeNative.bidiStream(call)
  },
})
```

`bootstrap.load()` is intentionally a GUI-oriented snapshot rather than a one-to-one copy of every HTTP route. Use `include` to request only the state needed by the current view. Failed subrequests are reported in `errors` while successful fields are still returned, so a missing optional subsystem does not block the desktop shell from opening.

PTY streaming is modeled as a gRPC bidirectional stream. The HTTP bridge adapts that stream to the existing WebSocket route for compatibility; native GUI hosts should implement it over their local gRPC, Unix-socket, or named-pipe transport instead of exposing the WebSocket route to renderer code.

When a real gRPC transport is available, provide it to `createAxCodeGrpcClient({ transport })`. The high-level client remains the same.

## Security Posture

For desktop apps, prefer this order:

1. In-process SDK when the GUI is TypeScript and can safely load the runtime.
2. Local gRPC/native transport over loopback, Unix socket, or named pipe.
3. HTTP/SSE headless bridge with generated one-time Basic Auth credentials.
4. Network HTTP only when explicitly configured and protected by `AX_CODE_SERVER_PASSWORD`.

When network HTTP is unavoidable, keep `/doc` disabled unless actively generating or debugging client contracts on a trusted network. Set `AX_CODE_ENABLE_HTTP_DOCS=1` only for that explicit case.

The HTTP compatibility bridge rejects cross-origin WebSocket upgrades by default. Add an origin to the explicit server CORS allowlist only when that browser origin is part of the trusted app shell.

Do not expose the full HTTP API, PTY WebSocket, or OpenAPI docs to arbitrary WebViews. If a WebView is used, keep it as a renderer and route privileged operations through the native host using the gRPC/native facade.

## Implementation Policy

- Keep gRPC optional. The CLI, TUI, HTTP SDK, and OpenAPI snapshot must continue to work.
- Do not duplicate every HTTP route in proto. Promote routes into gRPC only when the GUI needs them.
- Keep generated gRPC code out of handwritten SDK folders. Handwritten code belongs in `packages/sdk/js/src/grpc.ts`; generated code should live in a generated folder if added later.
- Treat HTTP as compatibility and observability infrastructure. Deprecate individual HTTP routes only after the GUI and integrations have a replacement and tests.
