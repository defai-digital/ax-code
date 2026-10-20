# SDK Architecture

## Purpose

`packages/sdk/js` contains the TypeScript SDK and programmatic, headless, and gRPC/native entry points. The private
workspace identity is `@ax-code/sdk`; the distribution identity is `@defai-digital/ax-code-sdk-internal`.

## Allowed Dependencies

- may depend on the runtime package as needed for SDK generation and programmatic access
- public app integrations use the headless or gRPC/native boundary with a separately distributed AX Code runtime

## Placement

- keep consumer-facing APIs stable and explicit
- generated code belongs under generated folders, not mixed into handwritten client logic
- GitHub Packages publication stages regenerated ESM and declarations in a private npm-compatible package; authenticated tarball readback and an isolated consumer are required

## Testing

- keep tests close to SDK behavior or in a dedicated harness when generation requires it
