# PRD: ax-code Programmatic SDK
## Feature #12 — Direct Agent Instantiation & Streaming API

**Author:** DEFAI Digital
**Date:** 2026-03-27
**Priority:** HIGH
**Estimated Effort:** 2-3 days
**Unlocks:** VSCode Extension (#17), IPC Layer (#18), CI/CD Integration

---

## 1. Problem Statement

The current `@ax-code/sdk` is an **HTTP client wrapper** — it requires spawning an `ax-code serve` subprocess and communicating over REST/SSE. This adds:

- **500ms-2s startup latency** per invocation (process spawn + HTTP listener)
- **50-200ms per API call** (network serialization overhead)
- **Process management complexity** (spawn, health check, teardown)
- **Cannot run in-process** (no direct library import)

This blocks:
- **VSCode extension** — HTTP overhead makes real-time code assistance too slow
- **CI/CD pipelines** — spawning a server per job is wasteful
- **Custom agent apps** — developers can't compose ax-code as a library
- **Testing** — requires running server for integration tests

### Current Architecture (What We Have)

```
Your Code → HTTP Client → [Network] → Hono Server → Agent Loop → LLM
                                         ↓
                                    SQLite + Tools
```

### Target Architecture (What We Need)

```
Your Code → Programmatic SDK → Agent Loop → LLM
                                    ↓
                              SQLite + Tools

(HTTP Server remains available as an optional deployment mode)
```

---

## 2. Goals

| Goal | Metric |
|------|--------|
| **Startup time** | <50ms (vs 500ms-2s current) |
| **Per-call latency** | <5ms (vs 50-200ms current) |
| **API surface** | Same capabilities as HTTP SDK |
| **Backward compatible** | HTTP SDK still works unchanged |
| **Type-safe** | Full TypeScript types for all inputs/outputs |
| **Streaming** | AsyncIterator-based token streaming |
| **Tool execution** | Direct tool invocation without agent loop |

---

## 3. Non-Goals

- Replacing the HTTP server (it stays for web/remote use cases)
- Rewriting the agent loop (reuse existing `session/prompt.ts`)
- Building the VSCode extension (separate feature #17)
- Supporting non-Bun runtimes (Bun-first, Node.js later)

---

## 4. Proposed API

### 4.1 Agent Creation

```typescript
import { createAgent } from "@ax-code/sdk/programmatic"

const agent = await createAgent({
  // Required
  directory: process.cwd(),

  // Optional — defaults to config file / env vars
  provider: "xai",
  model: "grok-4",

  // Optional — agent mode
  agent: "build",  // "build" | "security" | "architect" | "debug" | "perf" | "plan" | "react"

  // Optional — override permissions
  permissions: {
    bash: "allow",
    edit: "allow",
    read: "allow",
  },
})
```

### 4.2 Streaming Responses

```typescript
// Send a prompt and stream the response
const stream = agent.stream("Fix the login bug in src/auth/")

for await (const event of stream) {
  switch (event.type) {
    case "text":
      process.stdout.write(event.text)
      break

    case "tool-call":
      console.log(`Tool: ${event.tool} → ${event.input}`)
      break

    case "tool-result":
      console.log(`Result: ${event.output}`)
      break

    case "reasoning":
      console.log(`Thinking: ${event.text}`)
      break

    case "error":
      console.error(event.error)
      break

    case "done":
      console.log(`Tokens: ${event.usage.totalTokens}`)
      break
  }
}
```

### 4.3 One-Shot (Non-Streaming)

```typescript
const result = await agent.run("What does src/auth/index.ts do?")

console.log(result.text)        // Final text response
console.log(result.usage)       // { promptTokens, completionTokens, totalTokens }
console.log(result.toolCalls)   // Array of tool calls made
console.log(result.agent)       // Which agent handled it
console.log(result.model)       // Which model was used
```

### 4.4 Multi-Turn Conversations

```typescript
// Create a session for multi-turn
const session = await agent.session()

const r1 = await session.run("Read src/auth/index.ts")
console.log(r1.text)

const r2 = await session.run("Now add input validation to the set() function")
console.log(r2.text)

// Access full history
const messages = await session.messages()

// Fork conversation
const forked = await session.fork()
await forked.run("Actually, revert that and try a different approach")
```

### 4.5 Direct Tool Execution

```typescript
// Execute tools without the agent loop
const files = await agent.tool("glob", { pattern: "src/**/*.ts" })
const content = await agent.tool("read", { path: "src/auth/index.ts" })
const matches = await agent.tool("grep", { pattern: "TODO", path: "src/" })
const output = await agent.tool("bash", { command: "bun test" })
```

### 4.6 Custom System Prompt

```typescript
const agent = await createAgent({
  directory: process.cwd(),
  system: "You are a code reviewer. Only report issues, never modify code.",
  agent: "security",
})
```

### 4.7 Event Hooks

```typescript
const agent = await createAgent({
  directory: process.cwd(),
  hooks: {
    onToolCall: (tool, input) => {
      console.log(`Calling ${tool}...`)
      return true  // return false to block
    },
    onToolResult: (tool, output) => {
      console.log(`${tool} completed`)
    },
    onPermissionRequest: (permission) => {
      return "allow"  // auto-approve all
    },
    onError: (error) => {
      console.error(error)
    },
  },
})
```

### 4.8 Abort / Timeout

```typescript
const controller = new AbortController()

// Abort after 30 seconds
setTimeout(() => controller.abort(), 30000)

const result = await agent.run("Refactor the entire codebase", {
  signal: controller.signal,
})

// Or use timeout directly
const result = await agent.run("Quick question", {
  timeout: 10000,  // 10s
})
```

---

## 5. Implementation Plan

### Phase 1: Core Agent Loop (Day 1)

**Goal:** `createAgent()` + `agent.run()` working end-to-end

**Files to create:**
```
packages/sdk/js/src/programmatic/
  index.ts          — Main exports
  agent.ts          — createAgent() factory
  session.ts        — Session wrapper
  types.ts          — TypeScript interfaces
  stream.ts         — AsyncIterator streaming adapter
```

**What it does:**
1. `createAgent()` initializes the Effect runtime (same as server boot)
2. Sets up Instance, Config, Provider, Auth, Agent layers
3. Calls `SessionPrompt.prompt()` directly (same function the server uses)
4. Wraps the Bus events into an AsyncIterator for streaming

**Key insight:** The agent loop already runs in-process in `session/prompt.ts`. The HTTP server is just a thin wrapper. We bypass the HTTP layer and call `SessionPrompt.prompt()` directly.

### Phase 2: Streaming + Events (Day 1-2)

**Goal:** `agent.stream()` with typed events

**Approach:**
1. Subscribe to `Bus` events (same as SSE endpoint does)
2. Filter events for current session
3. Yield typed `StreamEvent` objects via AsyncIterator
4. Handle abort signals

**Events to expose:**
```typescript
type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool-call"; tool: string; input: unknown }
  | { type: "tool-result"; tool: string; output: string }
  | { type: "reasoning"; text: string }
  | { type: "error"; error: Error }
  | { type: "done"; usage: Usage; message: AssistantMessage }
```

### Phase 3: Session Management + Tools (Day 2)

**Goal:** Multi-turn sessions, tool execution, fork/revert

**Approach:**
1. Wrap `Session.create()`, `Session.messages()`, `Session.fork()` as methods
2. Direct tool execution via `ToolRegistry.execute()` bypass
3. Permission handling via callback hooks

### Phase 4: Polish + Tests (Day 2-3)

**Goal:** Error handling, cleanup, examples, documentation

**Deliverables:**
- Error types and recovery
- Graceful shutdown (cleanup DB connections, abort streams)
- 3 usage examples (one-shot, streaming, multi-turn)
- TypeScript type exports
- Update package.json exports

---

## 6. Technical Architecture

### 6.1 Layer Stack

```
createAgent()
  ↓
Effect Runtime (Layer composition)
  ├── Instance.layer      — Project directory, worktree
  ├── Config.layer        — Hierarchical config loading
  ├── Auth.layer          — API key management
  ├── Provider.layer      — LLM provider abstraction
  ├── Agent.layer         — Agent definitions + routing
  ├── ToolRegistry.layer  — 26 built-in tools
  ├── MCP.layer           — External tool servers
  ├── LSP.layer           — Language server integration
  ├── Session.layer       — SQLite session storage
  └── Bus.layer           — Internal event pub/sub
```

### 6.2 How It Reuses Existing Code

| Component | Existing Location | Reuse Strategy |
|-----------|------------------|----------------|
| Agent loop | `session/prompt.ts` | Call `SessionPrompt.prompt()` directly |
| Tool execution | `tool/registry.ts` | Use `ToolRegistry.execute()` |
| Provider calls | `provider/provider.ts` | Use `Provider.getLanguage()` |
| Session storage | `session/index.ts` | Use `Session.create()`, `Session.messages()` |
| Config loading | `config/config.ts` | Use `Config.get()` |
| Auth | `auth/index.ts` | Use `Auth.get()` |
| Event streaming | `bus/index.ts` | Subscribe to `Bus` events |
| Permission | `permission/index.ts` | Use `Permission.evaluate()` with callback |

**Estimated new code:** ~500-800 lines (thin wrapper, all logic reused)

### 6.3 Entry Point

```typescript
// packages/sdk/js/src/programmatic/index.ts

export { createAgent } from "./agent"
export type { Agent, AgentOptions, StreamEvent, RunResult, SessionHandle } from "./types"
```

```typescript
// packages/sdk/js/package.json (add export)
{
  "exports": {
    ".": "./src/index.ts",
    "./programmatic": "./src/programmatic/index.ts"
  }
}
```

---

## 7. Usage Examples

### Example 1: CI/CD Code Review

```typescript
import { createAgent } from "@ax-code/sdk/programmatic"

const agent = await createAgent({
  directory: process.cwd(),
  agent: "security",
})

const result = await agent.run("Scan this project for security vulnerabilities")

if (result.text.includes("HIGH")) {
  process.exit(1)  // Fail CI pipeline
}

console.log(result.text)
```

### Example 2: VSCode Extension (Future)

```typescript
import { createAgent } from "@ax-code/sdk/programmatic"

// One agent per workspace
const agent = await createAgent({
  directory: vscode.workspace.rootPath,
})

// Handle user chat
vscode.chat.onMessage(async (message) => {
  const stream = agent.stream(message.text)
  for await (const event of stream) {
    if (event.type === "text") {
      chatPanel.append(event.text)
    }
  }
})
```

### Example 3: Batch Processing

```typescript
import { createAgent } from "@ax-code/sdk/programmatic"

const agent = await createAgent({ directory: "." })

const files = ["src/auth.ts", "src/config.ts", "src/server.ts"]

for (const file of files) {
  const result = await agent.run(`Add JSDoc comments to all exported functions in ${file}`)
  console.log(`${file}: ${result.usage.totalTokens} tokens`)
}
```

### Example 4: Custom Agent Pipeline

```typescript
import { createAgent } from "@ax-code/sdk/programmatic"

// Step 1: Architect analyzes
const architect = await createAgent({ directory: ".", agent: "architect" })
const analysis = await architect.run("Analyze the auth module structure")

// Step 2: Security scans
const security = await createAgent({ directory: ".", agent: "security" })
const scan = await security.run("Scan src/auth/ for vulnerabilities")

// Step 3: Build agent fixes
const builder = await createAgent({ directory: ".", agent: "build" })
await builder.run(`
  Based on this analysis: ${analysis.text}
  And these security findings: ${scan.text}
  Fix the issues found.
`)
```

---

## 8. Success Criteria

| Criteria | Target |
|----------|--------|
| `createAgent()` startup | <50ms |
| `agent.run()` overhead (excluding LLM) | <5ms |
| Streaming first token | Same as HTTP SDK |
| All 26 tools accessible | Yes |
| Multi-turn conversation | Yes |
| Session persistence (SQLite) | Yes |
| Auto-routing works | Yes |
| MCP servers accessible | Yes |
| Abort/timeout support | Yes |
| Type-safe API | Full TypeScript types |
| Backward compatible | HTTP SDK unchanged |
| Example code | 3+ examples |

---

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Effect runtime complexity | Medium | Reuse exact same layer composition as server |
| SQLite concurrent access | Low | Same DB instance, single-writer |
| Tool permission model | Medium | Provide callback hook for programmatic approval |
| Memory usage | Low | Same as server process |
| Breaking changes | High | New export path (`/programmatic`), no changes to existing SDK |

---

## 10. Dependencies

| Dependency | Status |
|-----------|--------|
| Effect runtime | Already in codebase |
| Session/prompt loop | Already implemented |
| Tool registry | Already implemented |
| Provider abstraction | Already implemented |
| SQLite storage | Already implemented |
| Bus event system | Already implemented |

**No new external dependencies required.** Everything is already in the codebase — we're just exposing it through a new entry point.

---

## 11. Timeline

| Day | Deliverable |
|-----|------------|
| Day 1 | `createAgent()` + `agent.run()` working end-to-end |
| Day 1-2 | `agent.stream()` with typed events |
| Day 2 | `session.run()`, `agent.tool()`, multi-turn |
| Day 2-3 | Hooks, abort, error handling, examples, tests |

---

## 12. Future Extensions (Post-SDK)

| Feature | Depends On | Effort |
|---------|-----------|--------|
| VSCode extension (#17) | This SDK | 1 week |
| IPC layer (#18) | This SDK | 1 day |
| CI/CD GitHub Action | This SDK | 2 days |
| Custom tool registration | This SDK | 1 day |
| Remote agent orchestration | This SDK + IPC | 1 week |

---

*This PRD defines the Programmatic SDK feature for ax-code. Implementation reuses 95% of existing code — the SDK is a thin wrapper that bypasses the HTTP server layer and calls the agent loop directly.*
