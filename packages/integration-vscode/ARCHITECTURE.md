# VS Code Integration Architecture

## Purpose

`packages/integration-vscode/` contains the VS Code extension package that launches and integrates AX Code inside the editor.

## Allowed Dependencies

- may depend on `@ax-code/sdk`
- must not depend on `@ax-code/ui`

## Placement

- keep VS Code extension entrypoints, editor integration code, and extension packaging assets here
- do not place general-purpose repo tooling or shared runtime logic here

## Testing

- keep editor-specific behavior close to the extension entrypoints
- prefer colocated tests for pure helpers and command wiring

## License

`packages/integration-vscode` is licensed under MIT.

See [LICENSE](./LICENSE) for the full license text. If you redistribute this package, keep the LICENSE file and preserve the copyright and permission notice.
