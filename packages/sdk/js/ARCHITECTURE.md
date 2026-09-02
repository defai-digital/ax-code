# SDK Architecture

## Purpose

`packages/sdk/js` contains the TypeScript SDK and programmatic, headless, and gRPC/native entry points. The private
workspace identity is `@ax-code/sdk`; the public JSR identity is `@defai-digital/ax-code-sdk`.

## Allowed Dependencies

- may depend on the runtime package as needed for SDK generation and programmatic access
- public app integrations use the headless or gRPC/native boundary with a separately distributed AX Code runtime

## Placement

- keep consumer-facing APIs stable and explicit
- generated code belongs under generated folders, not mixed into handwritten client logic
- JSR publication stages regenerated ESM with explicit `.d.ts` bindings; npm publication is unsupported

## Testing

- keep tests close to SDK behavior or in a dedicated harness when generation requires it
