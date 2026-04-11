# Util Architecture

## Purpose

`packages/util` contains small shared utilities with minimal dependencies and broad reuse across the repo.

## Allowed Dependencies

- should remain dependency-light
- must not depend on `@ax-code/ui`

## Placement

- only add code here if it is generic and reusable across packages
- do not turn this package into a dumping ground for unrelated helpers

## Testing

- colocate tests when this package grows enough to need them

## License

`packages/util` is licensed under MIT.

See [LICENSE](./LICENSE) for the full license text. If you redistribute this package, keep the LICENSE file and preserve the copyright and permission notice.
