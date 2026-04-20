# PRD: Scoped npm Binary Packages

Status: Active
Date: 2026-04-19

## Summary

`ax-code` currently publishes the meta package as `@defai.digital/ax-code`, but publishes platform binary packages as unscoped names such as `ax-code-linux-x64`.

That split causes ownership, governance, and trust problems:

- the org page does not show the full official package set
- platform binaries appear to belong to an individual publisher account
- access control for release-critical artifacts is harder to reason about

This change makes the org scope the canonical npm namespace for all official `ax-code` packages.

## Goals

1. Publish all official npm packages under `@defai.digital/*`.
2. Keep `@defai.digital/ax-code` as the user-facing install entrypoint.
3. Make platform binaries canonical as:
   - `@defai.digital/ax-code-darwin-arm64`
   - `@defai.digital/ax-code-linux-x64`
   - `@defai.digital/ax-code-windows-x64`
4. Preserve runtime compatibility for installs that still contain legacy unscoped binary packages.
5. Align dist-tag workflows with the new scoped package names.

## Non-Goals

- No change to GitHub release asset naming.
- No trusted-publishing rollout in this patch. That requires npm org settings outside the repo.
- No source-workspace rename for the internal `packages/ax-code` package.

## Requirements

### R1. Canonical npm names must be scoped

New binary packages generated during release builds must use `@defai.digital/<legacy-name>` in their published `package.json`.

### R2. Meta package must depend on scoped binaries

The generated `@defai.digital/ax-code` package must write scoped binary package names into `optionalDependencies`.

### R3. Runtime must tolerate legacy installs

Binary resolution must try scoped package names first, then fall back to legacy unscoped names, so partially migrated environments do not fail immediately.

### R4. Dist-tag automation must target canonical names

The npm dist-tag workflow must retag the scoped binary packages, not the old unscoped names.

### R5. Publish metadata should express public intent

Generated npm package manifests should include `publishConfig.access = "public"` to reduce accidental restricted publishes.

## Success Criteria

1. New releases publish all official npm artifacts under `@defai.digital/*`.
2. The CLI wrapper resolves scoped binaries on fresh installs.
3. The wrapper still resolves legacy unscoped binaries when present.
4. Release workflows reference the same canonical package names as publish output.
