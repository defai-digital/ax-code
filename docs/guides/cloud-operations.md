# Cloud Operations Mode

Status: Active
Scope: current-state
Last reviewed: 2026-09-04
Owner: ax-code runtime

Cloud Operations Mode is a ready-made posture for administering infrastructure — cloud providers (AWS, GCP, Cloudflare, OVHcloud, DigitalOcean, RunPod) and network devices (VyOS, Juniper Junos) — where a mistake affects live systems and git rollback cannot restore state. It ships as the built-in **`cloudops` agent**: a system prompt plus a permission posture that you enable with one selection instead of hand-writing rules.

## What the mode gives you

- **Read-only-first agent.** The `cloudops` agent starts every task with inventory and dry-runs, and its prompt forbids mutation before a plan, a diff, and rollback recipes exist.
- **Ask-before-run shell.** `bash` is set to `ask`, so every shell command is confirmed. Cloud/network mutating verbs (`aws`/`gcloud`/`az`/`doctl` delete-family, `kubectl delete`/`apply --prune`, `terraform apply` without a plan file, ssh remote commit without commit-confirm, curl mutations against control-plane APIs) are classified `bash_destructive` and carry a separate non-bypassable interactive gate.
- **First-class ops tools.** `ops_plan`, `ops_diff`, `ops_verify`, and `ops_journal` are pre-allowed; `ops_approve` and `ops_apply` stay on their interactive paths (below).

## The workflow: plan → diff → approve → apply → verify → journal

1. **ops_plan** — open an OperationPlan: target (provider/account/region or device), intent, exact apply command and command context, and steps with effect, reversibility (`reversible | hard | irreversible`), and blast radius (`low | med | high`). Produces a canonical plan hash.
2. **ops_diff** — produce and review the machine-checkable artifact (`terraform plan -out`, `show | compare`, CLI dry-run output) and attach it. No diff, no approval.
3. **ops_approve** — the human approves the hash-pinned plan. This gate is interactive-only: no wildcard rule and no autonomous mode can pre-approve it, and no durable "always allow" grant is offered.
4. **ops_apply** — execute the approved plan's mutation with the approval token. This is the only sanctioned mutation path; the token is redeemed before anything runs.
5. **ops_verify** — run the plan's declarative read-only assertions and record pass/fail evidence.
6. **ops_journal** — query the append-only, project-scoped operation journal by project, plan, or status.

## Enabling the mode

In the TUI, pick **Cloud Ops** from the agent picker (or @-mention `cloudops` for a scoped task). To make it the default for a project, add to `ax-code.json`:

```json
{
  "default_agent": "cloudops",
  "isolation": {
    "mode": "workspace-write",
    "network": true
  }
}
```

`workspace-write` confines file changes to the workspace; `network: true` keeps webfetch, websearch, and provider CLIs reachable (network is otherwise off in sandboxed modes — see [Sandbox Mode](sandbox.md)). Both are session isolation settings, independent of the agent, so they are configured here rather than inside the agent preset.

You can tighten or extend the posture per project under `agent.cloudops.permission`, e.g. deny specific tools. Repository-committed config can only add **deny** rules; loosening an `ask` to `allow` must come from your trusted user or managed config, never from the repo. To remove the agent entirely, set `"agent": { "cloudops": { "disable": true } }`.

## A worked example

Applying a firewall change to a VyOS router:

1. You ask: "allow tcp/8443 from 10.0.0.0/8 on the edge firewall".
2. The agent loads the `vyos-firewall` skill, captures the current configuration over SSH (`show configuration commands` saved to a dated file), and opens a plan with `ops_plan`: one step, effect `add firewall rule`, reversibility `reversible` (rule deletion restores state), blast radius `med`.
3. It stages the change in config mode and attaches the device diff with `ops_diff`.
4. `ops_approve` shows you the plan hash and the exact staged change; you approve, and a 10-minute token is issued.
5. `ops_apply` redeems the token and runs the commit-confirm sequence; the automatic rollback timer stays armed until verification.
6. `ops_verify` checks reachability and that the rule matches the intended traffic; both the approval and the result are journaled, so a later `ops_journal` query reconstructs the whole change.

If the apply had failed at step 5, the token would be gone — step 4 would run again before any retry.

## Approval token semantics

- **Single-use** — redeemed atomically at the start of `ops_apply`; a consumed, unknown, or expired token fails with nothing executed.
- **TTL-bound** — default 10 minutes, maximum 60. Expiry is checked lazily at consume time; there is no background sweeper.
- **Plan-bound** — the token is issued against the plan's canonical sha256 hash, which includes the exact apply command, optional snapshot command, and working directory. Argument drift and tokens presented for a different plan are rejected before consumption, which prevents replay, cross-plan confusion, and command substitution.
- **Revealed once** — the raw token appears exactly once in the `ops_approve` result and is never persisted (only its sha256 is stored).
- **No refund** — a failed or timed-out apply does not return the token. Retrying requires re-approval through `ops_approve`.

## Security model

- **`bash_destructive` remains the gate for ad-hoc mutations.** The ops workflow covers planned change; one-off destructive commands still hit the destructive classifier and its interactive gate, and no permission rule can auto-approve them.
- **`ops_approve` is interactive-only**, like `isolation_escalation` and `bash_destructive`: it always prompts, even under wildcard-allow rulesets and in headless autonomous mode.
- **The journal is append-only from the agent's perspective** and project-scoped; it outlives sessions and is not cascaded on session deletion.
- **Skill packs carry provider runbooks.** `cloud-ops-aws`, `cloud-ops-gcp`, `cloud-ops-cloudflare`, `cloud-ops-digitalocean`, `cloud-ops-runpod`, `vyos-firewall`, and `junos-firewall` hold the read-only-first checklists, plan-before-mutate steps, and rollback patterns; the agent loads the matching pack before operating a surface. OVHcloud and other providers are covered through configured MCP servers and their documentation, not improvised CLI chains.
- **Credentials never reach the record.** Inline credential assignments in persisted bash inputs are redacted before they reach the event log.

## Strict mode

By default, a destructive-classified bash command (the `bash_destructive` family: cloud/network mutating verbs, `rm -rf`, `git push --force`, and the rest of the classifier list) receives a non-bypassable interactive ask — the user can approve the one-off command and it runs. **Strict mode removes that option.**

With strict mode enabled, a destructive-classified bash command is **denied outright**, before any ask. The deny message lists the classified commands with their reasons and directs the model to the sanctioned workflow: `ops_plan` → `ops_diff` → `ops_approve` (issues a single-use approval token) → `ops_apply`. Ad-hoc destructive shell mutations are no longer possible at all; every mutation must be planned, diffed, approved, and applied through the journal-backed path.

Enable it in trusted config (`ax-code.json` in your user config directory, managed config, or a project config the user has explicitly trusted):

```json
{
  "ops": {
    "strict": true
  }
}
```

Notes:

- **Interaction with the ask:** strict mode _replaces_ the `bash_destructive` ask with a hard deny. With the flag off (the default), behavior is exactly as described above — the interactive gate remains.
- **Scope:** the flag is global config, not per-agent — it applies to every bash call in the session, including subagents. The `cloudops` agent cannot enable it by itself; agents carry permissions and prompts, not config.
- **Trust-scoping:** untrusted, repository-committed project config cannot enable strict mode; opt in per machine (`AX_CODE_TRUST_PROJECT_CONFIG=1`) or set it in trusted user/managed config.
- **`ops_apply` is unaffected:** the sanctioned mutation path has its own plan-bound token gate inside the tool and never consults this flag.

## Source of truth

- `packages/ax-code/src/agent/agent.ts` — the `cloudops` agent definition and permission merge
- `packages/ax-code/src/agent/prompt/cloudops.txt` — the agent system prompt
- `packages/ax-code/src/tool/ops_*.ts` — the six ops tools and their descriptions
- `packages/ax-code/src/permission/index.ts` — `INTERACTIVE_ONLY` (`ops_approve`, `bash_destructive`, `isolation_escalation`)
- [Sandbox Mode](sandbox.md) — isolation modes, network controls, and precedence
