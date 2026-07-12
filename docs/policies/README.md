# Isolation policy packs

JSON policy examples for project-local permission / isolation posture. Copy into `.ax-code/policy.json` or merge rules into agent permissions as appropriate for your team.

| Pack | Intent |
|------|--------|
| [`read-only-audit.json`](./read-only-audit.json) | Audit / review sessions — no mutations |
| [`restricted-write.json`](./restricted-write.json) | Workspace writes only, tight bash |
| [`no-bash.json`](./no-bash.json) | File tools only — no shell |
| [`protect-secrets.json`](./protect-secrets.json) | Extra protection around secrets paths |
| [`file-scope-limit.json`](./file-scope-limit.json) | Limit agent to a file scope |
| [`workspace-verify.json`](./workspace-verify.json) | Prefer verification-heavy autonomous work |

See also: [Sandbox Mode](../sandbox.md), [Hooks](../hooks.md), [Autonomous Mode](../autonomous.md).
