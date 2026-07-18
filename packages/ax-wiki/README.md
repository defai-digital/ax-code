# `@ax-code/ax-wiki`

Model-agnostic core for AX Code's native, source-backed repository wiki.

The package owns deterministic source discovery and page planning, incremental source-to-page impact analysis, protected maintainer sections, candidate validation, atomic artifact writes, manifests, cards, related-page lookup, AGENTS pointers, and the session routing protocol. It accepts generation and optional graph-context callbacks so provider credentials and AX Code runtime concerns remain outside the core.

The user-facing workflow is documented in [`docs/wiki.md`](../../docs/wiki.md) and exposed through `ax-code wiki`.
