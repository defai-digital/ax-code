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
| Service boundary or non-JavaScript clients     | `ax-code serve` plus OpenAPI        | Lets Python, Go, Java, Rust, CI jobs, and internal platforms call the same runtime over HTTP |
| Editor-native workflow                         | VS Code integration                 | Uses the installed CLI/runtime while staying inside the editor                               |

For cross-language clients, see [HTTP and OpenAPI SDKs](../../../docs/sdk-http-openapi.md).

## Install

```bash
pnpm add @ax-code/sdk
```

The in-process `createAgent()` entry point loads the `ax-code` runtime from the host project at call time. Keep a compatible `ax-code` runtime installed or use `@ax-code/sdk/http` with `ax-code serve` when the runtime is provided as a separate service.

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

console.log(SDK_VERSION) // "2.0.0"
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
import { startHeadlessBackend } from "@ax-code/sdk/headless"
import { createAxCodeGrpcClientFromHttp } from "@ax-code/sdk/grpc"

const backend = await startHeadlessBackend({ directory: "/path/to/workspace" })
try {
  const client = createAxCodeGrpcClientFromHttp({
    baseUrl: backend.url,
    headers: backend.headers,
    directory: "/path/to/workspace",
  })

  const bootstrap = await client.bootstrap.load({
    include: { sessions: true, providers: true, providerList: true, path: true, vcs: true },
  })
  const terminal = await client.pty.create({ title: "Desktop shell" })

  const session = (await client.createSession({ title: "Desktop session" })) as { id: string }
  const messages = await client.session.messages(session.id, { limit: 50 })
  const skills = await client.app.skills()
  const readme = await client.file.read("README.md")
  await client.sendPrompt(session.id, { parts: [{ type: "text", text: "Review this project" }] })
} finally {
  await backend.close()
}
```

`bootstrap.load()` returns a partial GUI startup snapshot and an `errors` array for failed subrequests. `client.session` exposes session history and detail APIs for opening existing conversations without importing the full HTTP SDK. `client.app`, `client.project`, `client.file`, `client.find`, and `client.tool` cover GUI discovery and workspace navigation. PTY terminal access is exposed through `client.pty` with bidirectional streaming for interactive shells. `createAxCodeGrpcClientFromHttp()` is a compatibility bridge over the current headless HTTP/SSE/WebSocket backend. Native hosts can implement the same transport interface and pass it to `createAxCodeGrpcClient({ transport })`. The proto contract is published at [`../proto/ax_code/v1/headless.proto`](../proto/ax_code/v1/headless.proto).

## HTTP client (server-based)

The 1.4.0 default entry point (`createAxCode`) is still available at a subpath:

```ts
import { createAxCode } from "@ax-code/sdk/http"

const { client, server } = await createAxCode()
const sessions = await client.session.list()
```

## Cross-language integrations

Use this package for first-party TypeScript and JavaScript integrations. For first-party desktop/native GUI work, prefer `@ax-code/sdk/grpc` and keep HTTP/SSE as the compatibility and debug fallback. For Python, Go, Java, Rust, or other non-JavaScript runtimes, run `ax-code serve` and generate a client from the OpenAPI snapshot at [`../openapi.json`](../openapi.json) unless the integration is owned as part of the native GUI transport.

See [HTTP and OpenAPI SDKs](../../../docs/sdk-http-openapi.md) for the supported cross-language integration path and the criteria for promoting a generated client into a first-party package.

## Migration from 1.4.0

| Before (1.4.0)                                            | After (2.0.0)                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `import { createAxCode } from "@ax-code/sdk"`             | `import { createAxCode } from "@ax-code/sdk/http"`                     |
| `import { createAgent } from "@ax-code/sdk/programmatic"` | `import { createAgent } from "@ax-code/sdk"`                           |
| No custom tools                                           | `import { tool } from "@ax-code/sdk"` + `tools: [...]` on AgentOptions |
| No testing utilities                                      | `import { createMockAgent } from "@ax-code/sdk/testing"`               |
| No version check                                          | `import { SDK_VERSION } from "@ax-code/sdk"`                           |

The `./programmatic` subpath still works (re-exports everything from `.`) for backward compatibility but should be considered deprecated.

## More examples

See [`example/programmatic.ts`](./example/programmatic.ts) for a full set of working examples including security scanning with auto-approve permissions.

## License

MIT
