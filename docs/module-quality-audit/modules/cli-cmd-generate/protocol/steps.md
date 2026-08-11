# Review Protocol: cli-cmd-generate

## Step 1 Scope and Entry Points

The reviewed implementation is `packages/ax-code/src/cli/cmd/generate.ts`: it exports the pure `buildOperationCodeSample` helper at line 4 and the yargs-compatible `GenerateCommand` at lines 15-42. The command is reachable in both runtime assemblies: `packages/ax-code/src/cli/boot.ts:21,70` imports and registers it in the full CLI, while `packages/ax-code/src/cli/boot-node.ts:5,16` does the same for the reduced Node entrypoint. This agrees with the declared unit root in `docs/module-quality-audit/modules/cli-cmd-generate/MODULE-AUDIT.md:5-17`.

## Step 2 Inputs Outputs and Trust Boundaries

The command accepts no command-specific arguments; its only semantic input is the OpenAPI document returned by `Server.openapi()` at `packages/ax-code/src/cli/cmd/generate.ts:18`. That producer constructs the document from the in-process default route graph and fixed metadata at `packages/ax-code/src/server/server.ts:330-342`. The output boundary is stdout: the enriched document is serialized at `packages/ax-code/src/cli/cmd/generate.ts:32` and written at lines 35-39. Operation IDs are repository-defined schema metadata, not shell or network input, although they are interpolated into documentation source at line 9.

## Step 3 Correctness and Error Propagation

For every path, the handler visits `get`, `post`, `put`, `delete`, and `patch`, skips absent operations and operations without an ID, then installs one JavaScript sample (`packages/ax-code/src/cli/cmd/generate.ts:19-30`). The checked-in result demonstrates the intended dotted SDK access, for example `client.global.health` in `packages/sdk/openapi.json:198-203`. Serialization failures propagate from `JSON.stringify`, and stdout callback failures reject the awaited promise at `packages/ax-code/src/cli/cmd/generate.ts:32-40`; success is not reported before the write completes.

## Step 4 Security and Data Handling

This unit does not read credentials, environment variables, request bodies, or arbitrary files. It mutates only the newly generated in-memory specification (`packages/ax-code/src/cli/cmd/generate.ts:18-30`) and emits JSON to stdout. The sole string interpolation is the operation ID in a documentation snippet at lines 4-12; because the schema is assembled from the internal route graph at `packages/ax-code/src/server/server.ts:330-342`, this is not an external code-execution path. The command does not evaluate the generated snippet or invoke an SDK request.

## Step 5 Performance and Concurrency

Traversal is linear in the number of OpenAPI paths with a fixed five-method inner loop (`packages/ax-code/src/cli/cmd/generate.ts:19-21`). The complete document is retained and stringified in memory at line 32, which is reasonable for the repository snapshot but would scale with schema size. There is no shared mutable state or concurrent work: the specification is obtained once, enriched synchronously, and written once. Awaiting the stdout callback at lines 34-40 also prevents the CLI lifecycle from truncating a buffered document.

## Step 6 Design and Dependency Ownership

Responsibilities are narrow: `Server.openapi` owns schema construction (`packages/ax-code/src/server/server.ts:330-342`), `buildOperationCodeSample` owns sample formatting (`packages/ax-code/src/cli/cmd/generate.ts:4-13`), and the command handler owns enrichment plus output at lines 15-42. The generated import targets the public v2 factory, whose implementation is exported at `packages/sdk/js/src/v2/client.ts:15-43`. Dotted operation IDs align with the generated nested client structure, exemplified by the lazy `session` accessor in `packages/sdk/js/src/v2/gen/sdk.gen.ts:7349-7351`.

## Step 7 Maintainability and Test Coverage

Both exports are live: command registration is visible at `packages/ax-code/src/cli/boot.ts:70`, and `packages/ax-code/test/cli/generate.test.ts:3-12` directly exercises the formatting helper and guards the AX Code v2 import. The localized `@ts-expect-error` at `packages/ax-code/src/cli/cmd/generate.ts:23-29` documents the type-system boundary for the vendor extension, though a descriptive reason would improve future maintenance. The current test does not exercise method traversal, missing operation IDs, replacement of prior samples, or stdout rejection, leaving handler branches without focused unit coverage.

## Step 8 Finding Triage and Severity

The existing register reports no accepted findings at `docs/module-quality-audit/modules/cli-cmd-generate/MODULE-AUDIT.md:61-65`, and the unit's `findings/` directory contains no item to adjudicate. Independent review found no Critical correctness or security defect. The handler-test gap identified in Step 7 is a non-blocking coverage observation: production output is corroborated by the checked-in sample at `packages/sdk/openapi.json:198-203`, and write errors are explicitly rejected by `packages/ax-code/src/cli/cmd/generate.ts:35-39`.

## Step 9 Verification and Exit Decision

`AX_TEST_FILES=test/cli/generate.test.ts pnpm exec vitest run` passed one file and one test, exercising `packages/ax-code/test/cli/generate.test.ts:5-12`. `pnpm --dir packages/ax-code run typecheck` completed successfully against the typed command declaration at `packages/ax-code/src/cli/cmd/generate.ts:15-42`. A read-only `jq` check of `packages/sdk/openapi.json` counted 200 operations over the same five verbs used at `generate.ts:20` and found zero operations missing the single generated sample. The `cli-cmd-generate` review therefore exits with no blocking finding and no Critical re-verification artifact required.
