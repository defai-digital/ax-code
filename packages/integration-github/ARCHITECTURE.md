# GitHub Integration Architecture

## Purpose

`packages/integration-github/` contains the GitHub-specific integration package for repository automation and release flows.

## Allowed Dependencies

- may depend on `@ax-code/sdk`
- must not depend on `@ax-code/app`, `@ax-code/desktop`, or `@ax-code/ui`

## Placement

- keep GitHub workflow and release integration logic here
- do not place general-purpose repo tooling here

## Testing

- keep logic small and integration-oriented
