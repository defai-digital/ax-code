import { WorkflowSpecV1 as WorkflowSpecV1Schema, type WorkflowSpecV1 } from "./spec"

export const WorkflowFixtureSpecs = {
  noopDryRun: {
    schemaVersion: 1,
    id: "noop-dry-run",
    name: "Noop Dry Run",
    description: "Minimal workflow fixture for parser and feature-flag smoke checks.",
    tags: ["fixture", "dry-run"],
    phases: [
      {
        id: "noop",
        name: "Noop",
        kind: "noop",
        prompt: "Return a deterministic dry-run summary without using tools.",
      },
    ],
  },

  issueTriage: {
    schemaVersion: 1,
    id: "issue-triage",
    name: "Issue Triage",
    description: "Classify a small batch of issues with cheap parallel workers and a single synthesis phase.",
    tags: ["triage", "fanout"],
    budget: {
      maxTotalTokens: 120_000,
      maxConcurrentAgents: 8,
      maxTotalAgents: 16,
      maxToolCalls: 200,
    },
    modelPolicy: {
      workerModel: "cheap",
      synthesizerModel: "strong",
      effort: "workflow",
    },
    permissions: {
      writePolicy: "read-only",
      allowedTools: ["github.issue.view"],
      networkPolicy: "inherit",
      escalationPolicy: "ask",
    },
    artifacts: [
      {
        id: "issue-table",
        kind: "summary",
        exposeToMainContext: true,
      },
    ],
    phases: [
      {
        id: "collect-issues",
        name: "Collect Issues",
        kind: "fanout",
        agent: "worker",
        prompt: "Read each assigned issue and extract title, repro signal, risk, and likely owner.",
        outputs: [],
        maxParallel: 8,
      },
      {
        id: "synthesize-triage",
        name: "Synthesize Triage",
        kind: "synthesis",
        agent: "synthesizer",
        prompt: "Group the issue findings into actionable categories and emit a concise table.",
        dependsOn: ["collect-issues"],
        outputs: ["issue-table"],
        mergeStrategy: "all",
      },
    ],
  },

  verifiedBugSweep: {
    schemaVersion: 1,
    id: "verified-bug-sweep",
    name: "Verified Bug Sweep",
    description: "Read-only bug sweep with adversarial cross-checking before final synthesis.",
    tags: ["review", "fanout", "verification"],
    budget: {
      maxTotalTokens: 300_000,
      maxWallTimeMs: 2 * 60 * 60 * 1000,
      maxConcurrentAgents: 8,
      maxTotalAgents: 64,
      maxToolCalls: 800,
      maxRetries: 1,
    },
    modelPolicy: {
      plannerModel: "strong",
      workerModel: "cheap",
      verifierModel: "cheap",
      synthesizerModel: "strong",
      effort: "workflow",
      routing: [
        {
          phaseKind: "fanout",
          use: "worker",
        },
        {
          phaseKind: "verification",
          use: "verifier",
        },
        {
          phaseKind: "synthesis",
          use: "synthesizer",
        },
      ],
    },
    permissions: {
      writePolicy: "read-only",
      allowedTools: ["file.read", "rg", "verify_project"],
      networkPolicy: "disabled",
      escalationPolicy: "ask",
    },
    artifacts: [
      {
        id: "candidate-findings",
        kind: "finding",
        retention: "session",
      },
      {
        id: "verification-summary",
        kind: "verification",
        retention: "session",
      },
      {
        id: "bug-sweep-report",
        kind: "summary",
        retention: "session",
        exposeToMainContext: true,
      },
    ],
    verification: {
      mode: "required",
      workflow: "review",
      commands: ["bun test test/workflow/spec.test.ts"],
      requiredArtifactIds: ["verification-summary"],
    },
    phases: [
      {
        id: "plan-sweep",
        name: "Plan Sweep",
        kind: "sequential",
        agent: "planner",
        prompt: "Partition the repository into reviewable file groups with explicit exclusions.",
      },
      {
        id: "scan-files",
        name: "Scan Files",
        kind: "fanout",
        agent: "worker",
        prompt: "Inspect assigned files for concrete defects. Emit findings only with code evidence.",
        dependsOn: ["plan-sweep"],
        outputs: ["candidate-findings"],
        maxParallel: 8,
      },
      {
        id: "cross-check",
        name: "Cross Check",
        kind: "verification",
        agent: "verifier",
        prompt: "Try to falsify each candidate finding. Mark unsupported findings as rejected.",
        dependsOn: ["scan-files"],
        outputs: ["verification-summary"],
        maxParallel: 8,
        mergeStrategy: "critic-confirmation",
      },
      {
        id: "final-report",
        name: "Final Report",
        kind: "synthesis",
        agent: "synthesizer",
        prompt: "Return only validated findings with severity, evidence, and next actions.",
        dependsOn: ["cross-check"],
        outputs: ["bug-sweep-report"],
      },
    ],
  },
} satisfies Record<string, unknown>

export const InvalidWorkflowFixtureSpecs = {
  overBudget: {
    schemaVersion: 1,
    id: "over-budget",
    name: "Over Budget",
    description: "Invalid fixture that must fail scale guardrails.",
    budget: {
      maxTotalTokens: 1_000_000,
      maxConcurrentAgents: 32,
      maxTotalAgents: 2_000,
      maxToolCalls: 10_000,
    },
    phases: [
      {
        id: "fanout",
        name: "Fanout",
        kind: "fanout",
        maxParallel: 32,
      },
    ],
  },
} satisfies Record<string, unknown>

export type WorkflowFixtureName = keyof typeof WorkflowFixtureSpecs
export type InvalidWorkflowFixtureName = keyof typeof InvalidWorkflowFixtureSpecs

export function getWorkflowFixtureSpec(name: WorkflowFixtureName): unknown {
  return WorkflowFixtureSpecs[name]
}

export function getParsedWorkflowFixtureSpec(name: WorkflowFixtureName): WorkflowSpecV1 {
  return WorkflowSpecV1Schema.parse(WorkflowFixtureSpecs[name])
}
