# Testing Policy

This repo uses multiple valid test layouts. The rule is not "one layout everywhere". The rule is "one clear default per package type".

## Package Defaults

### `packages/ax-code`

- keep tests under `test/`
- mirror runtime domains where possible
- favor integration-style coverage over mocks
- use shared fixtures from `test/fixture`

### `packages/ui`

- colocate component and interaction tests next to exported components
- Storybook stories support development, but they do not replace automated tests
- stateful or keyboard-driven components should have automated coverage

### Small support packages

- colocate tests with the source unless an external harness requires otherwise

## Required Coverage Triggers

Add or update tests when a change:

- changes dependency flow
- changes keyboard, focus, selection, or drag behavior
- changes session prompt composition or message rendering
- changes provider, permission, replay, or persistence behavior
- extracts code from a hotspot file into a new module

## Refactor Rule

Large-file cleanup is only complete when the extracted unit has direct tests or is covered by a clearly adjacent higher-level test.
