# Contributing to AX Code

AX Code is developed internally by DEFAI Digital. We do not accept code contributions (pull requests) at this time.

## How You Can Help

We value community feedback. The best ways to contribute are:

### Report Bugs

Found something broken? [Open a bug report](https://github.com/defai-digital/ax-code/issues/new?template=bug_report.yml).

Include:

- What you expected vs. what happened
- Steps to reproduce
- Your platform (OS, AX Code version, provider/model)
- Error messages or screenshots if applicable

### Request Features

Have an idea? [Open a feature request](https://github.com/defai-digital/ax-code/issues/new?template=feature_request.yml).

Describe the problem you're trying to solve, not just the solution you want. This helps us design the right approach.

### Ask Questions

Stuck or confused? [Open a question](https://github.com/defai-digital/ax-code/issues/new?template=question.yml).

## Issue Guidelines

- Use one of the provided issue templates (bug report, feature request, or question)
- Be specific and concise
- One issue per report — don't bundle multiple bugs or requests
- Check [existing issues](https://github.com/defai-digital/ax-code/issues) before opening a duplicate

> **Note:** We do not accept AI-generated issues. Issues that are clearly AI-generated walls of text will be closed without review.

## Pull Requests

We are not accepting external pull requests. PRs from non-team members will be closed. If you've found a bug and know the fix, please describe it in a bug report and we'll handle the implementation.

## Working from source

Use Node.js 26 or later and the pnpm version in `package.json`. Use the Rust
toolchain in `rust-toolchain.toml` when building native addons.

```bash
git clone https://github.com/defai-digital/ax-code.git
cd ax-code
pnpm install --frozen-lockfile
pnpm dev
```

Use the [workspace map](ARCHITECTURE.md) to find the relevant package. See
[Installation and Runtime Channels](docs/getting-started/install-runtime.md#contributor-launcher-behavior)
for the packaged-runtime launcher and its SDK prerequisite.

| Change                       | Verify                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Documentation or repo layout | `pnpm run test:scripts` and `pnpm run check:structure`                                                     |
| Core runtime                 | `pnpm --dir packages/ax-code run typecheck` and `pnpm --dir packages/ax-code run test:ci -- deterministic` |
| HTTP routes or schema        | `pnpm --dir packages/sdk/js run build` and review the generated OpenAPI snapshot and clients               |
| Native addons                | `pnpm build:native` and the tests for the affected package                                                 |

For one core test file, run
`AX_TEST_FILES=test/path/example.test.ts pnpm --dir packages/ax-code exec vitest run`.
Run tests in their owning package, or use `pnpm run test:scripts` for repository scripts.

## Files kept locally

Keep project plans, working notes, and one-off maintenance scripts in `.internal/`. Keep credentials,
machine-specific config, session dumps, databases, and diagnostic exports local.
Use sanitized fixtures and example config in shared paths. Before sharing an
issue attachment, remove credentials, user data, and private repository details.

The pre-commit hook and repository CI run `sh script/check-tracked-local.sh`
against the staged root and package `.gitignore` files. Put repository-wide
ignores in the root file and package-specific outputs in that package's file.
Use your Git exclude file for personal preferences. For a file already tracked, use
`git rm --cached -- <path>` to remove it from the index while retaining the local
copy. Past commits retain their original contents.
