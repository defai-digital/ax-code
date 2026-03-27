/**
 * Programmatic SDK — Re-exports from ax-code's internal implementation
 *
 * The actual implementation lives in packages/ax-code/src/sdk/programmatic.ts
 * to avoid import resolution issues with ax-code's module system.
 */

// @ts-ignore — resolved via workspace linking
export { createAgent } from "ax-code/sdk/programmatic"
