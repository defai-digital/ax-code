# Verifier: ax-code-glm

- Unit: `crate-terminal`
- Finding: `AUDIT-crate-terminal-001` (Critical, stability)
- Evidence independently re-read: `crates/ax-code-terminal/src/lib.rs:143-160` and `crates/ax-code-terminal/src/lib.rs:883-920`
- Confirmation: unknown SS3 finals emit no phantom event and advance by `2 + ch.len_utf8()`, so the next slice remains on a UTF-8 boundary for ASCII, `é`, and `中` cases.
- Verification: `cargo test --manifest-path crates/Cargo.toml -p ax-code-terminal` exited 0 with 24 passed; `cargo clippy --manifest-path crates/Cargo.toml -p ax-code-terminal --all-targets -- -D warnings` exited 0.
- Disposition: `verified-fixed` remains supported by current source and regression tests.
