# @defai-digital/ax-code-sdk

TypeScript SDK for integrating the [AX Code](https://github.com/defai-digital/ax-code) coding-agent runtime into your own applications.

Use it to supervise a compatible signed AX Code runtime through typed **headless** or **gRPC** boundaries, consume streaming events, project session state, and test application integrations. Source hosts that deliberately provide the private runtime package may also use the in-process `createAgent()` adapter.

## Install

```bash
pnpm add jsr:@defai-digital/ax-code-sdk@2.6.4
```

```bash
deno add jsr:@defai-digital/ax-code-sdk@2.6.4
```

```bash
npx jsr add @defai-digital/ax-code-sdk@2.6.4
```

Requires **Node.js 26+** (or Deno with Node compatibility). Older Node.js versions are unsupported. Headless and gRPC lifecycle helpers expect a signed `ax-code` executable on `PATH`, or an absolute path passed as `binary`. SDK and runtime versions are independent. Check the runtime capability protocol before enabling app features; an SDK version check alone does not establish runtime compatibility.

The workspace package name `@ax-code/sdk` is private to this monorepo. Public consumers always install `@defai-digital/ax-code-sdk` from JSR.

## Choose an integration surface

| Need                        | Use                                           | Why                                                                                     |
| --------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Interactive repository work | `ax-code` TUI or `ax-code run`                | Fastest path for humans working in a checkout                                           |
| App shell or GUI backend    | `@defai-digital/ax-code-sdk/headless`         | Starts or attaches to a local backend with typed events and projected state             |
| Native desktop boundary     | `@defai-digital/ax-code-sdk/grpc`             | Stable command/event contract, streaming, metadata, deadlines, and native host adapters |
| Shared work-mode contracts  | `@defai-digital/ax-code-sdk/mode`             | Mode ids and helpers shared by TUI and app clients                                      |
| Provider connection picker  | `@defai-digital/ax-code-sdk/provider-connect` | Provider-category taxonomy without runtime-source imports                               |
| In-process source embedding | `@defai-digital/ax-code-sdk` `createAgent()`  | Lowest overhead and custom tools when the private runtime package is resolvable         |
| Editor-native workflow      | VS Code integration                           | Uses the installed CLI/runtime inside the editor                                        |

Public applications should use `headless` or `grpc` with a compatible signed AX Code runtime. HTTP/OpenAPI stays behind those SDKs as a fallback and diagnostics layer. Legacy `@defai-digital/ax-code-sdk/v2` subpaths remain for runtime compatibility; new integrations should not start there.

`createAgent()` loads the private `ax-code` source package at call time. The runtime is **not** published on JSR.

## Quick start (headless)

```ts
import { createHeadlessClient, startHeadlessBackend } from "@defai-digital/ax-code-sdk/headless"

const directory = process.cwd()
const backend = await startHeadlessBackend({ directory })
try {
  const client = createHeadlessClient({
    baseUrl: backend.url,
    directory,
    headers: backend.headers,
  })
  const session = await client.createSession({ title: "SDK example" })
  await client.sendPrompt(session.id, {
    parts: [{ type: "text", text: "Summarize this project." }],
  })
} finally {
  await backend.close()
}
```

Desktop hosts may pass a verified absolute path as `binary`. See
[example/headless-app.ts](https://github.com/defai-digital/ax-code/blob/HEAD/packages/sdk/js/example/headless-app.ts)
for a projection-based app loop.

## Headless backend

`startHeadlessBackend` spawns `ax-code serve` on a random loopback port, generates a one-time credential, waits for `/global/health`, and returns a handle. `close()` sends SIGTERM, then SIGKILL.

```ts
import {
  startHeadlessBackend,
  createHeadlessClient,
  createHeadlessProjectionState,
  applyHeadlessProjectionEvent,
} from "@defai-digital/ax-code-sdk/headless"

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

`createHeadlessProjectionState` and `applyHeadlessProjectionEvent` are pure TypeScript. App UIs should treat `permission`, `question`, `session_diff`, `todo`, `session_status`, and `session_error` as primary state. Autonomous replies are opt-in; supervised apps should render pending permission and question requests.

Autonomous projection keeps `isolation_escalation`, `bash_destructive`, `ops_approve`, `webmcp`, `hook`, and `computer` permissions pending, as well as any request whose metadata sets `requireInteractive: true`. Consumers must obtain an explicit human reply for these requests.

## gRPC / native desktop

Use `@defai-digital/ax-code-sdk/grpc` when a native host already owns the transport (Electron preload, Tauri, Rust, HTTP/2).

```ts
import {
  createAxCodeGrpcClientFromNativeIpc,
  resolveAxCodeGrpcProtoUrl,
  startAxCodeGrpcHeadlessBackend,
} from "@defai-digital/ax-code-sdk/grpc"

const backend = await startAxCodeGrpcHeadlessBackend({ directory: "/path/to/workspace" })
try {
  const client = backend.client
  await client.bootstrap.load({
    include: { sessions: true, providers: true, path: true, vcs: true },
  })
  const session = (await client.createSession({ title: "Desktop session" })) as { id: string }
  await client.sendPrompt(session.id, { parts: [{ type: "text", text: "Review this project" }] })
  const protoUrl = resolveAxCodeGrpcProtoUrl()
} finally {
  await backend.close()
}
```

- `createAxCodeGrpcClientFromNativeIpc()` — structured-clone IPC (preload / Tauri).
- `createAxCodeGrpcClientFromNativeBridge()` — same JavaScript realm, with `AbortSignal` and async iterables.
- `createAxCodeGrpcClientFromNativeHandlers()` — bind method names to typed handlers; `requireHandlers` fails fast on gaps.
- `startAxCodeGrpcNodeHttp2Server()` from `@defai-digital/ax-code-sdk/grpc/node` — expose the same bridge as a local HTTP/2 gRPC endpoint.
- `AX_CODE_GRPC_METHOD_DESCRIPTORS` / `listAxCodeGrpcMethods()` — canonical method catalog for allowlists and proto names.

`createAxCodeGrpcClientFromHttp()` is loopback-only. The proto asset is
[packages/sdk/proto/ax_code/v1/headless.proto](https://github.com/defai-digital/ax-code/blob/HEAD/packages/sdk/proto/ax_code/v1/headless.proto)
and is resolved at runtime with `resolveAxCodeGrpcProtoUrl()`.

## In-process agent (source hosts only)

This path requires the private `ax-code` runtime package. It is not the public app-integration boundary.

```ts
import { createAgent, tool } from "@defai-digital/ax-code-sdk"
import { z } from "zod"

const deploy = tool({
  name: "deploy_staging",
  description: "Deploy the current branch to staging",
  parameters: z.object({
    service: z.enum(["api", "web", "worker"]),
    skipTests: z.boolean().default(false),
  }),
  execute: async ({ service }) => ({ url: `https://staging.example.com/${service}` }),
})

const agent = await createAgent({ directory: "/repo", tools: [deploy] })

const result = await agent.run("Fix the login bug")
for await (const event of agent.stream("Explain this codebase")) {
  if (event.type === "text") process.stdout.write(event.text)
}
const session = await agent.session()
await session.run("Read src/auth/index.ts")
await agent.dispose()
```

Authentication is auto-detected from environment variables, injected via `auth: { provider, apiKey }`, or taken from `ax-code providers login`.

```ts
import { ProviderError, ToolError, TimeoutError } from "@defai-digital/ax-code-sdk"

try {
  await agent.run("Deploy to prod")
} catch (e) {
  if (e instanceof ProviderError && e.isRetryable) console.log("Rate limited, retry later")
  else if (e instanceof ToolError) console.log(`Tool "${e.tool}" failed: ${e.message}`)
  else if (e instanceof TimeoutError) console.log(`Timed out after ${e.timeout}ms`)
}
```

More examples:
[example/programmatic.ts](https://github.com/defai-digital/ax-code/blob/HEAD/packages/sdk/js/example/programmatic.ts).

## Testing

```ts
import { createMockAgent, assertToolSuccess } from "@defai-digital/ax-code-sdk/testing"

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
import { SDK_VERSION, isSDKVersionCompatible } from "@defai-digital/ax-code-sdk"

console.log(SDK_VERSION)
if (!isSDKVersionCompatible("^2.0.0")) {
  throw new Error("Incompatible SDK version")
}
```

## Request controls and steering

SDK 2.6 adds optional controls to headless requests. Existing calls retain their behavior; no default deadline is imposed.

```ts
import { createHeadlessClient, HeadlessRequestError } from "@defai-digital/ax-code-sdk/headless"

const client = createHeadlessClient({
  baseUrl: backend.url,
  headers: backend.headers,
  directory,
  requestOptions: { timeoutMs: 30_000 },
})
const compatibility = await client.checkCompatibility({ requiredFeatures: ["sessions", "asyncPrompt"] })
if (!compatibility.compatible) throw new Error(compatibility.issues.join("; "))

const controller = new AbortController()
const state = await client.steering(sessionID, { signal: controller.signal, timeoutMs: 5_000 })
if (state.generation) {
  try {
    const receipt = await client.steer(
      sessionID,
      {
        expectedGeneration: state.generation,
        clientID, // Keep this id with the correction so uncertain outcomes can be reconciled.
        text: "Use the existing session contract.",
      },
      { signal: controller.signal },
    )
    console.log(receipt.status)
  } catch (error) {
    if (error instanceof HeadlessRequestError && error.status === 409) {
      console.log("Correction conflicts with a prior request; reconcile the steering state.")
    } else {
      throw error
    }
  }
}
```

`client.taskQueue.steer(taskID)` exposes the atomic queued-follow-up endpoint. Its `generation_not_active` result leaves the row unchanged. The SDK returns receipts and rejection reasons verbatim. `accepted` means admitted for a later loop boundary; `applied` means durably admitted at that boundary, with provider completion still separate. Receipts are process-local and bounded, so their absence after a restart does not prove a correction was never applied.

`requestOptions` supplies defaults for all headless convenience requests and commands, including workflow and task-queue operations. Core session/command methods and steering accept per-call overrides; `timeoutMs: 0` disables a default deadline. Subscriptions use their own `signal`, and `client.client` retains the generated client's controls. A custom `HeadlessTransport` receives the signal and should release its pending resources when it aborts.

HTTP and IPC cancellation stop the local wait. A dispatched mutation can still execute; reconcile session/queue state before taking further action. Neither transport retries mutations. Deadlines raise `TimeoutError`; caller aborts preserve the signal's reason. Non-success HTTP and IPC responses raise `HeadlessRequestError` with `status`, `body`, `method`, and `path`; IPC protocol error frames retain `IpcTransportError`.

## Runtime compatibility and upgrading from SDK 2.5

| Check                                             | What it establishes                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `isSDKVersionCompatible(range)`                   | Installed SDK version satisfies the supported SDK range syntax                             |
| `client.checkCompatibility({ requiredFeatures })` | Runtime advertises capability schema 1, headless schema 1, and the requested feature flags |
| `client.steering(sessionID)`                      | This runtime exposes the session steering endpoint and its current generation              |
| Signed runtime verification                       | Binary identity and provenance, independently of capability responses                      |

The current generated contract baseline is AX Code source v7.23.0. SDK 2.6 does not infer unadvertised features from the runtime version. The current capability catalog does not advertise steering separately; check the read endpoint before offering steering, and handle unsupported-route errors. SDK 2.6 preserves the existing generated and headless entry points. New response-error metadata and request controls are additive; code catching `Error` continues to work.

Applications upgrading older pins should first verify their signed runtime, then test capability negotiation, event projection, pending permissions/questions, cancellation, and backend shutdown. Consumer pin changes belong in the consuming repository after the target SDK is published. Validate the compiled package locally with `pnpm --dir packages/sdk/js run test:consumer`; this checks public imports, declarations, and proto assets in an isolated fixture without the private runtime source package.

## Cross-language integrations

This package is the first-party TypeScript/JavaScript SDK. For Python, Go, Java, Rust, or other runtimes, generate from the repository gRPC proto or use the CLI/runtime boundary owned by that integration.

## Migration from `@ax-code/sdk` 1.4.0

| Before (`@ax-code/sdk` 1.4.0)                             | After (`@defai-digital/ax-code-sdk` 2.6.4)                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `import { createAxCode } from "@ax-code/sdk"`             | `import { startHeadlessBackend } from "@defai-digital/ax-code-sdk/headless"` |
| `import { createAxCodeClient } from "@ax-code/sdk"`       | `import { createHeadlessClient } from "@defai-digital/ax-code-sdk/headless"` |
| `import { createAxCodeServer } from "@ax-code/sdk"`       | `import { startHeadlessBackend } from "@defai-digital/ax-code-sdk/headless"` |
| `import { createAgent } from "@ax-code/sdk/programmatic"` | `import { createAgent } from "@defai-digital/ax-code-sdk"`                   |
| No custom tools                                           | `import { tool } from "@defai-digital/ax-code-sdk"`                          |
| No testing utilities                                      | `import { createMockAgent } from "@defai-digital/ax-code-sdk/testing"`       |

The `./programmatic` subpath still re-exports the default entry; treat it as deprecated.

## License

Apache-2.0
