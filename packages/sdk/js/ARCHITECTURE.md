# SDK Architecture

## Purpose

`packages/sdk/js` contains the JavaScript SDK and programmatic client/server entry points.

## Allowed Dependencies

- may depend on the runtime package as needed for SDK generation and programmatic access
- must not depend on `@ax-code/ui`

## Placement

- keep consumer-facing APIs stable and explicit
- generated code belongs under generated folders, not mixed into handwritten client logic

## Testing

- keep tests close to SDK behavior or in a dedicated harness when generation requires it
