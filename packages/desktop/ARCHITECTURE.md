# Desktop Architecture

## Purpose

`packages/desktop` contains the Tauri shell, desktop bootstrapping, updater integration, and generated bindings for the app.

## Allowed Dependencies

- may depend on `@ax-code/app` and `@ax-code/ui`
- must not bypass generated bindings for Tauri commands

## Placement

- keep shell and desktop integration code in this package
- keep product UI and feature behavior in `packages/app`
- prefer generated bindings over ad hoc command wiring

## Testing

- keep logic small and integration-focused
- test app behavior in `packages/app` unless the behavior is desktop-specific
