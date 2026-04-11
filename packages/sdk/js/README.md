# @ax-code/sdk

TypeScript SDK for embedding the [ax-code](https://github.com/defai-digital/ax-code) AI coding agent into your own applications.

## Install

```bash
pnpm add @ax-code/sdk
```

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
    case "text": process.stdout.write(event.text); break
    case "tool-call": console.log(`Calling ${event.tool}...`); break
    case "tool-result": console.log(`${event.tool} → ${event.status}`); break
    case "done": console.log(`\nTokens: ${event.result.usage.totalTokens}`); break
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
    toolCalls: [
      { tool: "grep", input: { pattern: "CVE-" }, output: "CVE-2025-1234" },
    ],
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

## HTTP client (server-based)

The 1.4.0 default entry point (`createAxCode`) is still available at a subpath:

```ts
import { createAxCode } from "@ax-code/sdk/http"

const { client, server } = await createAxCode()
const sessions = await client.session.list()
```

## Migration from 1.4.0

| Before (1.4.0) | After (2.0.0) |
|---|---|
| `import { createAxCode } from "@ax-code/sdk"` | `import { createAxCode } from "@ax-code/sdk/http"` |
| `import { createAgent } from "@ax-code/sdk/programmatic"` | `import { createAgent } from "@ax-code/sdk"` |
| No custom tools | `import { tool } from "@ax-code/sdk"` + `tools: [...]` on AgentOptions |
| No testing utilities | `import { createMockAgent } from "@ax-code/sdk/testing"` |
| No version check | `import { SDK_VERSION } from "@ax-code/sdk"` |

The `./programmatic` subpath still works (re-exports everything from `.`) for backward compatibility but should be considered deprecated.

## More examples

See [`example/programmatic.ts`](./example/programmatic.ts) for a full set of working examples including security scanning with auto-approve permissions.

## License

`@ax-code/sdk` is licensed under MIT.

See [LICENSE](./LICENSE) for the full license text. If you redistribute this package, keep the LICENSE file and preserve the copyright and permission notice.
