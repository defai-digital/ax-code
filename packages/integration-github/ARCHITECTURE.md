# GitHub Integration Architecture

## Purpose

`packages/integration-github/` is an action shell: it hosts the composite GitHub Action (`action.yml`) that installs the published ax-code CLI and runs `ax-code github run`. The GitHub integration implementation lives in `packages/ax-code/src/cli/cmd/github-agent/`.

## Allowed Dependencies

- no runtime dependencies; the action shells out to the published ax-code CLI

## Placement

- keep the action definition and its user-facing docs here
- do not place GitHub workflow implementation logic here; it belongs in the core `github-agent` command

## Testing

- the canonical implementation is tested in `packages/ax-code/test/cli/`
