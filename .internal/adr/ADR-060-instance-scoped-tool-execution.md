# ADR-060: Instance-Scoped Tool Execution and Raw-Prompt-Free Request Evidence

**Status:** Accepted
**Date:** 2026-08-21
**Decision owners:** AX Code runtime maintainers

## Context

AX Code serves multiple project `Instance`s in one Node process. Tool initializers and MCP clients are project-bound,
yet parts of their caches and coordination are module-global. AX Code also has several invocation surfaces: direct
model tools, Batch, and MCP. Their policy and hook behavior has drifted because Batch invokes implementations
directly. Finally, replay records the start of a model request before the final request is assembled.

DeepSeek Harness demonstrates useful effect/disposer and event-envelope discipline, but its everything-is-plugin
container and session model do not justify replacing AX Code's stronger existing subsystems.

## Decision

### 1. Runtime caches belong to `Instance.state`

Initialized registry tools, MCP discovery values/promises/generations/subscriptions, and the MCP connection queue are
owned by the current instance. Module-global caches are prohibited for values that can capture directory, worktree,
configuration, permissions, client connections, or instance-scoped event buses.

MCP teardown closes admission and the already-established client snapshot first, then waits for startup and admitted
queue work to settle, and finally closes any late client. This minimizes process-residual time while retaining the
disposed-state guard for work that completes after shutdown begins.

### 2. Use a thin invocation boundary, not a new container

AX Code will centralize registry-tool invocation in the existing session/tool layer. The boundary composes current
plugin hooks, lifecycle hooks, permission context, output mapping, and isolation behavior. It is deliberately smaller
than a general dependency-injection or plugin framework.

### 3. Isolation policy is surface-specific

- Direct model calls may use the existing interactive isolation escalation.
- Batch uses the same enabled-tool and hook boundary but fails closed on isolation denial. Its dispatcher does not
  initiate interactive `isolation_escalation` retries from parallel workers; existing tool-specific permission checks
  remain in force.
- MCP remains an external trust boundary, is excluded from Batch, and gains lifecycle-hook evidence without being
  silently reclassified as an AX-isolated local process.

### 4. Registrations are scoped effects

`ToolRegistry.register()` returns an idempotent disposer. Registrations are layered so disposal removes only the
caller's contribution and correctly reveals any older layer.

### 5. Persist fingerprints, not request bodies

The replay event stores a versioned manifest for AX Code's AI-SDK pre-adapter assembly containing identities, ordered
names, counts, selected common options, and SHA-256 fingerprints. Its options fingerprint also covers the sanitized
provider-specific options, and the exact same in-memory provider-options object is passed to the AI SDK. Raw system
prompts, conversation content, provider-option values, headers, credentials, and arguments are not added to replay by
default. This is privacy-minimized pseudonymous evidence, not anonymous evidence: unsalted hashes leak equality and
can expose low-entropy values to dictionary guessing. The manifest remains under normal replay retention/access
controls and does not attest to later adapter or wire changes.

## Consequences

### Positive

- Multi-project servers no longer share initialized tools or MCP discovery state.
- Disabled tools cannot be reached through Batch's alternate path.
- Hook authors receive consistent evidence across supported call surfaces.
- Request evidence becomes comparable without adding raw request bodies to replay.
- Extension registrations can be cleaned up precisely.

### Costs

- The invocation layer must avoid recursive Batch dispatch and keep MCP explicitly out of the registry dispatcher.
- Per-instance caches repeat a small amount of initialization that module globals previously shared incorrectly.
- Fingerprints prove equality/difference but cannot reconstruct a raw provider request; they still carry equality and
  dictionary-guessing leakage.

## Alternatives rejected

- **Include the instance directory in global cache keys:** still leaves global subscriptions, disposal, clients, and
  unbounded project identities coupled at module scope.
- **Give Batch raw registry access plus duplicated checks:** policy will drift again.
- **Use direct-call isolation escalation inside Batch:** concurrent prompts can deadlock or produce confusing policy
  interactions.
- **Put MCP in Batch:** expands the trust and permission surface and contradicts Batch's current contract.
- **Persist full requests by default:** improves reconstruction at an unacceptable privacy and credential-retention
  cost.
- **Adopt Cordis/everything-is-plugin:** disproportionate migration risk with little benefit for these defects.
