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
