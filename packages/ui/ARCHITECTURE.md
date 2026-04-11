# UI Architecture

## Purpose

`packages/ui` contains shared UI components, content rendering, icons, styles, and UI-only helpers used by Storybook and any future visual surfaces.

## Allowed Dependencies

- may depend on `@ax-code/sdk` and `@ax-code/util`

## Placement

- group new components by concern instead of keeping the package flat
- current grouped folders include `actions/`, `forms/`, `layout/`, `navigation/`, `overlay/`, and `status/`
- keep primitive controls separate from session/file/content-specific components
- keep rendering helpers and icon systems out of unrelated component files

## Testing

- colocate tests with exported components
- add automated coverage for stateful, focus-sensitive, or rendering-heavy components
- use stories to support development, not as a replacement for tests

## License

`packages/ui` is licensed under MIT.

See [LICENSE](./LICENSE) for the full license text. If you redistribute this package, keep the LICENSE file and preserve the copyright and permission notice.
