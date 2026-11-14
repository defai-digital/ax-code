# Repository architecture

AX Code is a pnpm workspace containing the CLI/TUI product, reusable libraries,
SDK contracts, and native bindings. The top-level layout separates those owners;
new features belong in the existing domain before a new package is introduced.

## Workspace map

| Package directory                  | Responsibility                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/ax-code`                 | Product composition: CLI, TUI application, HTTP server, sessions, providers, tools, permissions and storage              |
| `packages/ax-tui`                  | Publishable terminal UI framework; authored TypeScript/Solid sources, Zig renderer and verified distribution artifacts   |
| `packages/sdk/js`                  | SDK APIs, headless/native transports and generated HTTP clients; `packages/sdk/openapi.json` records the server contract |
| `packages/plugin`                  | Plugin contracts and tool helpers                                                                                        |
| `packages/integration-github`      | GitHub integration entry point                                                                                           |
| `packages/util`                    | Dependency-light helpers with demonstrated reuse across packages                                                         |
| `packages/script`                  | Shared build/release metadata helpers; distinct from executable repository scripts                                       |
| `packages/ax-code-intel`           | Language-server orchestration and semantic results                                                                       |
| `packages/ax-code-reason`          | Reusable reasoning and analysis services                                                                                 |
| `packages/ax-agent-runtime`        | Private runtime incubation contracts; executable policy remains in the product                                           |
| `packages/ax-wiki`                 | Publishable, model-independent wiki compiler                                                                             |
| `packages/ax-wiki-viewer`          | Reusable offline wiki evidence viewer                                                                                    |
| `packages/ax-computer`             | Private, unreleased computer-use integration                                                                             |
| `packages/akitty-sdk`              | Verified compiled SDK snapshot; implementation is owned by AkiTTY                                                        |
| `packages/ax-code-diff-wasm`       | Worker-hosted WASM diff runtime                                                                                          |
| `packages/ax-code-diff-native`     | JavaScript binding package for the Rust diff addon                                                                       |
| `packages/ax-code-fs-native`       | JavaScript binding package for the Rust filesystem addon                                                                 |
| `packages/ax-code-index-core`      | JavaScript binding package for the Rust index addon                                                                      |
| `packages/ax-code-parser-native`   | JavaScript binding package for the Rust parser addon                                                                     |
| `packages/ax-code-terminal-native` | JavaScript binding package for the Rust terminal addon                                                                   |
| `packages/ax-code-daemon`          | JavaScript binding package for the Rust background daemon                                                                |

`pnpm-workspace.yaml` owns workspace discovery, catalog versions, overrides,
patches and dependency build permissions. Root `package.json` retains workspace
patterns for compatible tooling; its patterns must match the YAML. Package
manifests own their dependency edges and public `exports` contracts. Use
`workspace:` for local dependencies, including aliases such as `ax-tui`.

## Placement and boundaries

- `crates/` is the Rust Cargo workspace. Binding packages under `packages/`
  provide the JavaScript-facing distribution boundary.
- `script/` contains repository-wide automation. Package-local `script/`
  directories own that package's build, validation and publication tooling.
  `tools/` contains external distribution tooling such as Winget manifests.
- `docs/` contains released, user-facing guidance. Local planning and decision
  records belong in the ignored `.internal/` tree and must never be published.
- Core `src/` and `test/` follow domain ownership. CLI and HTTP surfaces compose
  domain modules; domain modules must not import CLI/server interface code.
- Command implementations and helpers are grouped under `src/cli/cmd/doctor/`,
  `run/`, `providers/` and `mcp/`. Root `doctor.ts`, `run.ts`, `providers.ts` and
  `mcp.ts` remain stable facades. Keep new helpers with their command family.
- Cross-package runtime/test imports use package exports. Relative paths must
  stay inside their workspace package. Workspace dependency cycles fail checks.
- SDK generated code, AX TUI generated runtime files and vendored SDK/native
  snapshots retain their existing rebuild/verification workflows. Folder
  cleanup must not remove distribution artifacts needed by a clean checkout.

## Structural verification

Run `pnpm run check:structure` and `pnpm run test:scripts` for repository layout
changes. The boundary checker discovers packages from the workspace YAML and
checks root runtime modules and nested `src/`, `source/` and `test/` trees. It
excludes tooling/benchmark trees (`script/`, `perf/`), declarations, dependency
folders, `dist/`, `vendor/` and the AX TUI renderer receipt's generated files.
These exclusions do not replace each package's own build and integrity checks.

For command moves, compile the SDK first (`pnpm --dir packages/sdk/js exec tsc`)
so clean-checkout SDK exports resolve, then run `pnpm run typecheck`, affected
CLI tests, core deterministic tests and the static gates listed in the root
README. Verify source-inspection tests and self-scan baseline paths as well as
module imports; both can refer to implementation files by filename.

The structure report lists large source files as review signals. Extract a
cohesive responsibility when a frequently changed module becomes difficult to
review; preserve its facade and cover the behavior before moving logic. File
size alone does not justify splitting locale tables or stable protocol data.
