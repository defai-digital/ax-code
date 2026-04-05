# App Architecture

## Purpose

`packages/app` contains the web UI and route composition for AX Code.

## Allowed Dependencies

- may depend on `@ax-code/ui`, `@ax-code/sdk`, `@ax-code/util`
- must not import internal source files from other packages directly

## Placement

- keep route composition in `src/pages`
- keep reusable app-specific UI in `src/components`
- keep shared app state in `src/context`
- put shared test helpers in `src/testing`
- move session-specific logic into feature-owned modules instead of expanding route files indefinitely
- group `src/pages/session` by feature area such as `composer/`, `history/`, `hooks/`, `message/`, `review/`, `state/`, `tabs/`, and `terminal/`
- keep route-facing imports stable with thin entry shims while real implementations live inside those feature folders

## Testing

- colocate unit tests with components, hooks, context, and page helpers
- keep end-to-end coverage in `e2e/`
