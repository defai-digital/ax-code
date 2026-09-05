---
name: cloud-ops-gcp
description: Operate GCP resources (Compute Engine, GKE, Cloud SQL, Cloud Storage, IAM) with read-only inventory first, a confirm-before-delete plan, and an IaC rollback recipe. Use when the user asks to inspect, change, or clean up Google Cloud infrastructure.
agent: cloudops
argument-hint: <operation and target resources, e.g. "resize the cloud sql instance in staging">
---

Handle the GCP operation in $ARGUMENTS as a reversible change, not a sequence of gcloud one-liners.

## Phase 1 - Identity and project

- Run `gcloud config get-value project` (and `gcloud auth list`) and state the project and account before anything else.
- Confirm the project is the intended one (dev vs staging vs production). If it is a production project and the user did not explicitly ask for it, stop.

## Phase 2 - Read-only inventory first

- Use only `list`/`describe`/get operations: `gcloud compute instances list`, `gcloud sql instances describe`, `gcloud storage ls`, `gcloud container clusters list`.
- Record names, zones, state, labels, and dependencies of the target resources. Mutate nothing in this phase.

## Phase 3 - Plan (required before any delete)

- Write the exact command(s) to run, including project and zone/region flags.
- List every resource each command affects, plus blast radius (disks, firewall rules, load balancer backends, DNS).
- Where the command supports `--dry-run` or `--quiet` validation, show the dry-run output first.
- Present the exact command to the user and get explicit confirmation of that exact command before executing.

## Phase 4 - Execute

- Run the confirmed command only. Do not chain extra mutations that were not part of the plan.
- Verify the result with read-only list/describe calls and report the new state.

## Phase 5 - Rollback recipe

- State the rollback path before executing Phase 4, not after something breaks.
- Redeploy from IaC (Terraform, Deployment Manager, Config Connector) using the last applied state; review the plan before applying.
- Restore data: compute instance snapshots, Cloud SQL PITR or automated backups, Cloud Storage versioning.
- State what cannot be rolled back (deleted non-versioned objects, released external IPs).

## Constraints

- Never inline service-account keys or tokens in commands; use application-default or configured credentials.
- Prefer `--dry-run` whenever the operation supports it.
- Never touch production projects without an explicit user ask for that project.
- Prefer MCP GCP tools over shell commands when they are configured.
