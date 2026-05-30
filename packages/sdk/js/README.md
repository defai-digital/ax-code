# @ax-code/sdk

Status: Active
Scope: current-state
Last reviewed: 2026-04-28
Owner: ax-code sdk

TypeScript SDK for embedding the [ax-code](https://github.com/defai-digital/ax-code) AI coding agent into your own applications.

Use the SDK when you want AX Code's runtime inside your own TypeScript or JavaScript process: streaming events, persistent sessions, custom tools, and test helpers without shelling out to the CLI.

## Choose the Right Integration Surface

| Need                                           | Use                                 | Why                                                                                          |
| ---------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| Interactive repository work                    | `ax-code` TUI or `ax-code run`      | Fastest path for humans working directly in a checkout                                       |
| In-process TypeScript or JavaScript automation | `@ax-code/sdk` with `createAgent()` | Lowest overhead, custom tools, streaming, multi-turn sessions, and testing helpers           |
| App shell or GUI backend                       | `@ax-code/sdk/headless`             | Starts or attaches to a local backend with typed events and projected app state              |
| Native desktop boundary                        | `@ax-code/sdk/grpc`                 | Stable command/event contract, streaming, metadata, deadlines, and native host adapters      |
| Editor-native workflow                         | VS Code integration                 | Uses the installed CLI/runtime while staying inside the editor                               |

The JavaScript package no longer exposes first-party HTTP client/server subpaths. HTTP/OpenAPI remains an internal
runtime, fallback, and diagnostics layer behind the headless and gRPC SDKs.

## Install

```bash
pnpm add @ax-code/sdk
```

The in-process `createAgent()` entry point loads the `ax-code` runtime from the host project at call time. Keep a compatible `ax-code` runtime installed. For app shells that should not load runtime internals directly, use `@ax-code/sdk/headless` or `@ax-code/sdk/grpc`.

## Quick start

```ts
import { createAgent } from "@ax-code/sdk"

const agent = await createAgent({ directory: "." })
for await (const event of agent.stream("What does src/index.ts do?")) {
  if (event.type === "text") process.stdout.write(event.text)
}
await agent.dispose()
```

## Custom tools

Define tools with Zod schemas. The `execute` function receives typed arguments.

```ts
import { createAgent, tool } from "@ax-code/sdk"
import { z } from "zod"

const deploy = tool({
  name: "deploy_staging",
  description: "Deploy the current branch to staging",
  parameters: z.object({
    service: z.enum(["api", "web", "worker"]),
    skipTests: z.boolean().default(false),
  }),
  execute: async ({ service, skipTests }) => {
    // Your code runs here, inside the agent's tool-call loop.
    // Return any JSON-serializable value.
    return { url: `https://staging.example.com/${service}` }
  },
})

const agent = await createAgent({
  directory: "/repo",
  tools: [deploy],
})
```

## One-shot vs streaming vs multi-turn

```ts
// One-shot — wait for the full response
const result = await agent.run("Fix the login bug")
console.log(result.text)

// Streaming — async iterator of typed events
for await (const event of agent.stream("Explain this codebase")) {
  switch (event.type) {
    case "text":
      process.stdout.write(event.text)
      break
    case "tool-call":
      console.log(`Calling ${event.tool}...`)
      break
    case "tool-result":
      console.log(`${event.tool} → ${event.status}`)
      break
    case "done":
      console.log(`\nTokens: ${event.result.usage.totalTokens}`)
      break
  }
}

// Multi-turn — persistent session across messages
const session = await agent.session()
await session.run("Read src/auth/index.ts")
const result = await session.run("Now add input validation")
```

## Error handling

```ts
import { createAgent, ProviderError, ToolError, TimeoutError } from "@ax-code/sdk"

try {
  const result = await agent.run("Deploy to prod")
} catch (e) {
  if (e instanceof ProviderError && e.isRetryable) {
    console.log("Rate limited, retry later")
  } else if (e instanceof ToolError) {
    console.log(`Tool "${e.tool}" failed: ${e.message}`)
  } else if (e instanceof TimeoutError) {
    console.log(`Timed out after ${e.timeout}ms`)
  }
}
```

## Authentication

```ts
// Option 1: Environment variable (auto-detected)
// Set ANTHROPIC_API_KEY, XAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, etc.

// Option 2: Direct injection (no local config needed)
const agent = await createAgent({
  directory: ".",
  auth: { provider: "xai", apiKey: "xai-abc123" },
})

// Option 3: Pre-configured via `ax-code providers login`
const agent = await createAgent({ directory: "." })
```

## Testing

Use `createMockAgent` to unit-test your agent integration without calling a real LLM.

```ts
import { createMockAgent, assertToolSuccess } from "@ax-code/sdk/testing"

test("CI bot scans for CVEs", async () => {
  const agent = createMockAgent({
    replies: ["Found 2 CVEs. Opening PR to bump versions."],
    toolCalls: [{ tool: "grep", input: { pattern: "CVE-" }, output: "CVE-2025-1234" }],
  })

  const result = await agent.run("scan for CVEs")
  expect(result.text).toContain("2 CVEs")
  assertToolSuccess(result, "grep")
})
```

## Version compatibility

```ts
import { SDK_VERSION, isSDKVersionCompatible } from "@ax-code/sdk"

console.log(SDK_VERSION) // "2.1.0"
if (!isSDKVersionCompatible("^2.0.0")) {
  throw new Error("Incompatible SDK version")
}
```

## Headless backend SDK

Use `@ax-code/sdk/headless` when your application needs to manage the AX Code server lifecycle, subscribe to a typed event stream, and maintain projected state — all without coupling to the internal runtime package.

```ts
import {
  startHeadlessBackend,
  createHeadlessClient,
  createHeadlessProjectionState,
  applyHeadlessProjectionEvent,
} from "@ax-code/sdk/headless"

const backend = await startHeadlessBackend({ directory: "/path/to/workspace" })
try {
  const client = createHeadlessClient({ baseUrl: backend.url, headers: backend.headers })
  const state = createHeadlessProjectionState()
  const session = await client.createSession({ title: "My session" })

  await client.sendPrompt(session.id, { parts: [{ type: "text", text: "Review this project" }] })
  for await (const event of client.subscribe()) {
    applyHeadlessProjectionEvent(state, event)
    if (state.session_status[session.id]?.type === "idle") break
  }
} finally {
  await backend.close()
}
```

`startHeadlessBackend` spawns `ax-code serve` on a random port, generates a one-time auth credential, verifies `/global/health`, and resolves once the server is ready. `close()` terminates the backend process tree with SIGTERM and a SIGKILL fallback.

The projection functions (`createHeadlessProjectionState`, `applyHeadlessProjectionEvent`) are pure TypeScript with no runtime dependencies — safe for use in any environment.

App UIs should treat `permission`, `question`, `session_diff`, `todo`, `session_status`, and `session_error` as primary state. Autonomous replies are opt-in through projection options; supervised apps should render pending permission and question requests and answer them with the headless client helpers.

See [`example/headless-app.ts`](./example/headless-app.ts) for a minimal app-style integration that starts a local backend, creates a session, sends a prompt, projects events, and shuts the backend down.

## gRPC/native desktop SDK

Use `@ax-code/sdk/grpc` for first-party desktop or native GUI integrations that want a gRPC-shaped command/event contract without exposing the full HTTP route tree to the app shell.

```ts
import {
  createAxCodeGrpcClientFromNativeBridge,
  createAxCodeGrpcClientFromNativeIpc,
  resolveAxCodeGrpcProtoUrl,
  startAxCodeGrpcHeadlessBackend,
} from "@ax-code/sdk/grpc"

const backend = await startAxCodeGrpcHeadlessBackend({ directory: "/path/to/workspace" })
try {
  const client = backend.client

  const bootstrap = await client.bootstrap.load({
    include: { sessions: true, providers: true, providerList: true, path: true, vcs: true },
  })
  const terminal = await client.pty.create({ title: "Desktop shell" })

  const session = (await client.createSession({ title: "Desktop session" })) as { id: string }
  const messages = await client.session.messages(session.id, { limit: 50 })
  const skills = await client.app.skills()
  const readme = await client.file.read("README.md")
  const authMethods = await client.provider.auth()
  const protoUrl = resolveAxCodeGrpcProtoUrl()
  await client.sendPrompt(session.id, { parts: [{ type: "text", text: "Review this project" }] })
} finally {
  await backend.close()
}
```

`bootstrap.load()` returns a partial GUI startup snapshot and an `errors` array for failed subrequests. `client.session` exposes session history and detail APIs for opening existing conversations without importing the full HTTP SDK. `client.app`, `client.instance`, `client.project`, `client.path`, `client.vcs`, `client.command`, `client.file`, `client.find`, and `client.tool` cover app logging, lifecycle controls, GUI discovery, and workspace navigation. `client.context` and `client.debugEngine` cover project context, cached-memory, template, and pending-plan diagnostics. `client.permission` and `client.question` cover supervised approval and clarification flows. `client.workflowRun` covers run lists, dashboard summaries, artifacts, eval summaries, and eval cases. `client.config`, `client.runtime`, `client.provider`, `client.auth`, `client.mcp`, `client.lsp`, and `client.formatter` cover runtime settings, provider settings, API-key auth, provider OAuth, MCP lifecycle/resource controls, and diagnostics status through the same native boundary. `client.subscribeEvents()` accepts optional `types` and `sessionID` filters for GUI projections. PTY terminal access is exposed through `client.pty` with bidirectional streaming for interactive shells. `createAxCodeGrpcClientFromHttp()` is a loopback-only compatibility bridge over the current headless HTTP/SSE/WebSocket backend by default; pass `allowRemoteHttpBridge: true` only for an explicitly trusted remote server. Native hosts can implement the same transport interface and pass it to `createAxCodeGrpcClient({ transport })`. The proto contract is published at [`../proto/ax_code/v1/headless.proto`](../proto/ax_code/v1/headless.proto) and included in the package at `@ax-code/sdk/proto/ax_code/v1/headless.proto`; `resolveAxCodeGrpcProtoUrl()` returns the local file URL for the installed package.

For a desktop host that already owns a Rust, Tauri, Electron preload, or gRPC client boundary, use `createAxCodeGrpcClientFromNativeIpc()` for structured-clone IPC boundaries and implement `unary`, `serverStream`, and optionally `bidiStream` in the host. Use `createAxCodeGrpcNativeIpcBridgeFromChannels()` or `createAxCodeGrpcNativeIpcStream()` when the host exposes push-style subscriptions with unsubscribe callbacks. Use `createAxCodeGrpcClientFromNativeBridge()` only when both sides share a JavaScript realm and can pass `AbortSignal` and async iterables directly in the call object. Hosts that want less custom dispatch code can use `createAxCodeGrpcNativeBridgeFromHandlers()` or `createAxCodeGrpcClientFromNativeHandlers()` to bind method names to typed runtime handlers; pass `requireHandlers` to fail fast when an expected method set, domain, or stream kind is missing. Node-based desktop hosts can expose the same bridge as a real HTTP/2 gRPC endpoint with `startAxCodeGrpcNodeHttp2Server()` from `@ax-code/sdk/grpc/node`. Use `AX_CODE_GRPC_METHOD_DESCRIPTORS`, `listAxCodeGrpcMethods()`, `getAxCodeGrpcMethodDescriptor()`, `assertAxCodeGrpcMethodSupported()`, `listMissingAxCodeGrpcNativeHandlers()`, or `assertAxCodeGrpcNativeHandlers()` as the canonical method catalog and startup coverage gate for native handler coverage, service binding, preload allowlists, and proto request/response message names. The renderer keeps the same high-level client API without receiving the HTTP base URL, auth header, or PTY WebSocket endpoint.

## Cross-language integrations

Use this package for first-party TypeScript and JavaScript integrations. For first-party desktop/native GUI work, prefer `@ax-code/sdk/grpc`; use `@ax-code/sdk/headless` when a local backend process is still the right lifecycle boundary. HTTP/SSE stays behind those SDKs as compatibility and debug infrastructure, not as a first-party JavaScript SDK surface. For Python, Go, Java, Rust, or other non-JavaScript runtimes, generate from the published gRPC proto at `@ax-code/sdk/proto/ax_code/v1/headless.proto` or use the CLI/runtime boundary owned by that integration.

## Migration from 1.4.0

| Before (1.4.0)                                            | After (2.1.0)                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `import { createAxCode } from "@ax-code/sdk"`             | `import { startHeadlessBackend } from "@ax-code/sdk/headless"`         |
| `import { createAxCodeClient } from "@ax-code/sdk"`       | `import { createHeadlessClient } from "@ax-code/sdk/headless"`         |
| `import { createAxCodeServer } from "@ax-code/sdk"`       | `import { startHeadlessBackend } from "@ax-code/sdk/headless"`         |
| `import { createAgent } from "@ax-code/sdk/programmatic"` | `import { createAgent } from "@ax-code/sdk"`                           |
| No custom tools                                           | `import { tool } from "@ax-code/sdk"` + `tools: [...]` on AgentOptions |
| No testing utilities                                      | `import { createMockAgent } from "@ax-code/sdk/testing"`               |
| No version check                                          | `import { SDK_VERSION } from "@ax-code/sdk"`                           |

The `./programmatic` subpath still works (re-exports everything from `.`) for backward compatibility but should be considered deprecated.

## More examples

See [`example/programmatic.ts`](./example/programmatic.ts) for a full set of working examples including security scanning with auto-approve permissions.

## License

MIT
