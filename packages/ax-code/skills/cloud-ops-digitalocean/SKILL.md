---
name: cloud-ops-digitalocean
description: Operate DigitalOcean resources (Droplets, Volumes, Databases, Firewalls, Spaces) via doctl with read-only inventory first, pre-change snapshots, and an IaC rollback recipe. Use when the user asks to inspect, change, or clean up DigitalOcean infrastructure.
agent: cloudops
argument-hint: <operation and target resources, e.g. "resize the staging droplet">
---

Handle the DigitalOcean operation in $ARGUMENTS as a reversible change, not an impulsive doctl command.

## Phase 1 - Identity and account

- Run `doctl account get` and state the account and team context before anything else.
- Confirm the account is the intended one. If it is a production environment and the user did not explicitly ask for it, stop.

## Phase 2 - Read-only inventory first

- Use only read-only list/get operations: `doctl compute droplet list`, `doctl compute volume list`, `doctl databases list`, `doctl compute firewall list`.
- Record IDs, names, region, state, and attached resources. Mutate nothing in this phase.

## Phase 3 - Plan (required before any delete/destroy)

- Write the exact command(s) to run, including the resource ID and region.
- List every resource each command affects, plus blast radius (attached volumes, floating IPs, firewall rules, load balancer members).
- Before any `doctl compute droplet delete`, take a snapshot first; before editing a firewall, export its rules to JSON.
- Present the exact command to the user and get explicit confirmation of that exact command before executing.

## Phase 4 - Execute

- Run the confirmed command only. Do not chain extra mutations that were not part of the plan.
- Verify the result with read-only list/get calls and report the new state.

## Phase 5 - Rollback recipe

- State the rollback path before executing Phase 4, not after something breaks.
- Droplets: rebuild from the pre-change snapshot, or redeploy from IaC (Terraform) using the last applied state.
- Databases: restore from the latest backup or fork from a point in time.
- Firewalls: re-apply the exported JSON rules captured in the plan phase.

## Constraints

- `doctl compute droplet delete` requires an explicit user ask and confirmation of the exact command.
- Never inline `DIGITALOCEAN_ACCESS_TOKEN` values in commands; rely on the configured context.
- Never destroy a droplet without a fresh snapshot or an explicit user waiver.
