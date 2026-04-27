# AX Code Architecture

## Purpose

`packages/ax-code` contains the product runtime: CLI, TUI, server, session engine, tool orchestration, storage, and provider integration.

## Allowed Dependencies

- may depend on `@ax-code/util`, `@ax-code/plugin`, `@ax-code/script`, `@ax-code/sdk`
- must not depend on `@ax-code/ui`

## Placement

- put domain logic in domain folders such as `session`, `project`, `provider`, `permission`, `tool`
- keep interface layers in `cli`, server routes, and other entry surfaces
- keep reusable low-level helpers in shared utility modules, not inside CLI or route files
- avoid adding new unrelated logic to `src/cli` when it belongs in a domain package
- group `src/cli/cmd` by concern such as `github-agent/`, `runtime/`, and `storage/`, and keep root command files as thin compatibility shims

## Testing

- tests live under `test/`
- mirror runtime domains where practical
- prefer real integration coverage over mocks

---

## Effect Framework Policy (as of v2.11.0)

### Frozen: No New Effect Usage

New code must NOT introduce Effect dependencies unless modifying an existing Effect-based module.

**Disallowed in new code:**

- `Effect.gen`, `Layer.effect`, `Layer.service`, `ServiceMap.Service`
- `InstanceState.make`, `InstanceState.get`
- `Schema.Class`, `Schema.Struct` (use Zod instead)

**Allowed in new code:**

- `async/await` for all async operations
- `Result<T, E>` or `.catch()` for error handling
- Zod (`z.object()`) for validation
- `Log.create()` for structured logging
- Plain TypeScript functions

**Where Effect remains (core only):**

- `src/effect/` — runtime infrastructure
- `src/session/` — session processing loop
- `src/file/watcher.ts` — subscription lifecycle

## Coding Patterns (AI-first)

### Linear Control Flow (Default)

```typescript
async function editFile(path: string): Promise<Result<void, EditError>> {
  const exists = await fs
    .access(path)
    .then(() => true)
    .catch(() => false)
  if (!exists) return { ok: false, error: { code: "NOT_FOUND" } }
  await fs.writeFile(path, content)
  return { ok: true, value: undefined }
}
```

### Structured Logging

```typescript
const log = Log.create({ service: "tool.edit" })
log.info("edit complete", { toolName: "edit", durationMs: 42, status: "ok" })
```

Required fields: `toolName`/`command`, `durationMs`, `status` ("ok"|"error"), `errorCode` (on error).

### Boundary Validation

Validate at edges (CLI args, config, tool input), trust internally. Use Zod, not Effect Schema.

### Error Handling

- `Result<T, E>` for: tool execution, file mutation, LLM response, config loading
- `.catch()` for: simple fallbacks
- `try/catch` for: boundary wrapping
- NOT `Effect.gen` + error channel for new code

## Schema Library

**Standard: Zod** (already in 117+ files). Do not introduce Valibot or other schema libraries.

### Validation Coverage

| Component       | Schema Type                                            | Status                    |
| --------------- | ------------------------------------------------------ | ------------------------- |
| Tool parameters | Zod (`z.object()`) in all 27 tools                     | Validated at runtime      |
| Config          | Pure Zod strict mode (709 lines in `config/schema.ts`) | Complete                  |
| ID types        | Effect Schema + Zod bridge (`util/effect-zod.ts`)      | Keep bridge               |
| CLI args        | Yargs type inference                                   | Add Zod for critical args |

### Effect-Zod Bridge

`src/util/effect-zod.ts` (99 lines) converts Effect Schema ASTs to Zod schemas. This bridge is **kept** — it allows existing Effect Schema ID types (SessionID, ToolID, etc.) to work with Zod-based validation. Do not rewrite ID schemas to pure Zod unless the module is being fully migrated from Effect.

### New Schema Pattern

```typescript
// New code: pure Zod
const InputSchema = z.object({
  path: z.string(),
  content: z.string().optional(),
})
type Input = z.infer<typeof InputSchema>
```

## Native Addons (Rust)

CPU-bound hot paths dispatch to Rust when flags enabled:

- `AX_CODE_NATIVE_INDEX=1` — SQLite graph, interval tree, lock
- `AX_CODE_NATIVE_FS=1` — File walker, glob, grep, watcher
- `AX_CODE_NATIVE_DIFF=1` — Edit replacer, fuzzy matcher, diff
- `AX_CODE_NATIVE_PARSER=1` — Tree-sitter symbol extraction

All native paths use `createRequire(import.meta.url)` with try/catch fallback.
