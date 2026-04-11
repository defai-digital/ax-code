# Plugin Architecture

## Purpose

`packages/plugin` contains plugin-facing helpers, types, and integration glue for the AX Code ecosystem.

## Allowed Dependencies

- may depend on `@ax-code/sdk`
- must not depend on `@ax-code/ui`

## Placement

- keep plugin contracts and helper surfaces narrow
- do not pull product UI or app-specific state into this package

## Testing

- colocate tests or add focused package-level tests as the surface grows

## License

`packages/plugin` is licensed under MIT.

See [LICENSE](./LICENSE) for the full license text. If you redistribute this package, keep the LICENSE file and preserve the copyright and permission notice.
