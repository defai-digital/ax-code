---
name: cloud-ops-cloudflare
description: Operate Cloudflare resources (Workers, R2, DNS, Pages) via wrangler and the API with read-only inventory first, versioned rollback, and explicit confirmation for deletes. Use when the user asks to inspect, change, or clean up Cloudflare infrastructure.
agent: devops
argument-hint: <operation and target resources, e.g. "deploy the worker to production">
---

Handle the Cloudflare operation in $ARGUMENTS as a reversible change, not an impulsive wrangler command.

## Phase 1 - Identity and account

- Run `wrangler whoami` and state the account, token scope, and environment before anything else.
- Confirm the account is the intended one. If it is a production environment and the user did not explicitly ask for it, stop.

## Phase 2 - Read-only inventory first

- Use only read-only calls: `wrangler r2 bucket list`, `wrangler kv namespace list`, `wrangler d1 list`, zone GETs via the API (`GET /zones/{zone_id}/dns_records`).
- Record resource IDs, bindings, and current versions. Mutate nothing in this phase.

## Phase 3 - Plan (required before any delete)

- Write the exact command(s) or API calls to run, including account, zone, and resource IDs.
- List every resource each command affects, plus blast radius (custom domains, routes, KV bindings).
- Present the exact command to the user and get explicit confirmation of that exact command before executing.

## Phase 4 - Execute

- Run the confirmed command only. Do not chain extra mutations that were not part of the plan.
- Verify the result with read-only calls (`wrangler deployments list`, zone GETs) and report the new state.

## Phase 5 - Rollback recipe

- Workers: roll back to a previous version with `wrangler rollback <version-id>` or `wrangler deployments list` then redeploy.
- DNS: recreate the deleted record from the exported zone data (export records before any edit).
- R2: restore overwritten objects via object versioning or lifecycle-recovered copies.

## Constraints

- `wrangler delete` requires an explicit user ask and confirmation of the exact command.
- Never print or inline `CLOUDFLARE_API_TOKEN` values; rely on the configured credentials.
- Never touch production zones without an explicit user ask for that zone.
