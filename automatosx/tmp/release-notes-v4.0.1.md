# ax-code v4.0.1

This patch release fixes the release pipeline regression that blocked the `v4.0.0` automation from completing.

## Highlights

- Fixed the `skill discovery` deterministic test fixture so it only serves the expected public origin and remains compatible with SSRF-pinned fetch behavior.
- Restored the release workflow path needed for tagged builds to proceed through publish and Homebrew update jobs.

## Verification

- `pnpm --dir packages/ax-code exec bun test test/skill/discovery.test.ts`
- `CI=1 pnpm --dir packages/ax-code run test:ci -- deterministic`
