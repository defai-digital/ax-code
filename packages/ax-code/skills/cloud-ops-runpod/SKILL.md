---
name: cloud-ops-runpod
description: Operate RunPod resources (pods, serverless endpoints, volumes, network storage) with read-only API/CLI inventory first and snapshot-before-delete discipline, because GraphQL deletions are FINAL. Use when the user asks to inspect, change, or clean up RunPod infrastructure.
agent: cloudops
argument-hint: <operation and target resources, e.g. "stop the idle training pod">
---

Handle the RunPod operation in $ARGUMENTS as a reversible change, even though the platform makes many operations irreversible.

## Phase 1 - Identity and account

- State the RunPod API key source (env var or CLI config) and the account context before anything else.
- Confirm the environment is the intended one. If it is a production or billing-enabled environment and the user did not explicitly ask for it, stop.

## Phase 2 - Read-only inventory first

- Use only read-only queries: GraphQL `pods { id name imageName ... }`, `myself { networkVolumes { ... } }`, serverless endpoints query, or `runpodctl get pod` where the CLI is available.
- Record pod IDs, volume IDs, GPU types, and hourly cost. Mutate nothing in this phase.

## Phase 3 - Plan (required before any mutation)

- Write the exact mutation or command to run, including every resource ID.
- List every resource each mutation affects, plus blast radius (network volumes shared across pods, endpoints serving traffic).
- GraphQL mutations such as `podTerminate` are FINAL: there is no undo and no soft delete. Say so explicitly in the plan.
- Present the exact mutation to the user and get explicit confirmation of that exact mutation before executing.

## Phase 4 - Execute

- Run the confirmed mutation only. Do not chain extra mutations that were not part of the plan.
- Before any destructive op on a volume or pod with data, take a snapshot of the volume or network storage.
- Verify the result with read-only queries and report the new state.

## Phase 5 - Rollback recipe

- Pods: there is no platform rollback for termination; rollback means redeploying from the saved image/template plus restored volume data.
- Volumes: restore from the snapshot taken in the plan phase.
- Endpoints: redeploy the previous container image version and re-point traffic.

## Constraints

- Never inline `RUNPOD_API_KEY` values in commands or mutation bodies.
- Never run a GraphQL delete/terminate mutation without an explicit user ask and confirmation of the exact mutation.
- Always snapshot volumes or network storage before any destructive operation on them.
