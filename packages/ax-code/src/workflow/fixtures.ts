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
    inputs: [
      {
        id: "issue-limit",
        label: "Issue Limit",
        description: "Maximum number of issues to classify.",
        type: "number",
        default: 10,
      },
    ],
    routine: {
      enabled: false,
      mode: "api",
      apiRoute: "workflow/issue-triage",
      securityGate: "local-only",
    },
    budget: {
      maxTotalTokens: 120_000,
      maxConcurrentAgents: 8,
      maxTotalAgents: 16,
      maxToolCalls: 200,
    },
    modelPolicy: {
      cheapModel: "cheap",
      strongModel: "strong",
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
      maxConcurrentAgents: 3,
      maxTotalAgents: 25,
      maxToolCalls: 800,
      maxRetries: 1,
    },
    modelPolicy: {
      cheapModel: "cheap",
      strongModel: "strong",
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
        redaction: {
          status: "pending",
          summary: "Raw candidate analysis is stored for drill-down; compact workflow views carry finding summaries.",
        },
      },
      {
        id: "verification-summary",
        kind: "verification",
        retention: "session",
        redaction: {
          status: "pending",
          summary: "Verification details are summarized in compact views and available through artifact drill-down.",
        },
      },
      {
        id: "bug-sweep-report",
        kind: "summary",
        retention: "session",
        exposeToMainContext: true,
        redaction: {
          status: "none",
          summary: "Final bug sweep report is intended for the parent session compact summary.",
        },
      },
    ],
    verification: {
      mode: "required",
      workflow: "review",
      commands: ["bun test test/workflow/spec.test.ts"],
      requiredArtifactIds: ["verification-summary"],
    },
    synthesis: {
      agent: "synthesizer",
      outputFormat: "findings",
      exposeToMainContext: true,
      requiredArtifactIds: ["bug-sweep-report"],
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
        maxParallel: 3,
      },
      {
        id: "cross-check",
        name: "Cross Check",
        kind: "verification",
        agent: "verifier",
        prompt: "Try to falsify each candidate finding. Mark unsupported findings as rejected.",
        dependsOn: ["scan-files"],
        outputs: ["verification-summary"],
        maxParallel: 3,
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

  issueToVerifiedFix: {
    schemaVersion: 1,
    id: "issue-to-verified-fix",
    name: "Issue to Verified Fix",
    description: "Reproduce a failure, apply a minimal fix, then re-run the same check before reporting done.",
    tags: ["fix", "verification"],
    inputs: [
      {
        id: "issue",
        label: "Issue",
        description: "Bug report, failing test, or symptom to fix.",
        type: "string",
        required: true,
      },
    ],
    budget: {
      maxTotalTokens: 200_000,
      maxConcurrentAgents: 2,
      maxTotalAgents: 8,
      maxToolCalls: 400,
    },
    modelPolicy: {
      cheapModel: "cheap",
      strongModel: "strong",
      plannerModel: "strong",
      workerModel: "strong",
      verifierModel: "cheap",
      synthesizerModel: "strong",
      effort: "workflow",
    },
    permissions: {
      writePolicy: "serialized",
      allowedTools: ["file.read", "rg", "edit", "bash", "verify_project"],
      networkPolicy: "inherit",
      escalationPolicy: "ask",
    },
    artifacts: [
      {
        id: "before-signal",
        kind: "verification",
        retention: "session",
        redaction: {
          status: "none",
          summary: "Command and output captured before the edit.",
        },
      },
      {
        id: "after-signal",
        kind: "verification",
        retention: "session",
        redaction: {
          status: "none",
          summary: "Same command re-run after the edit.",
        },
      },
      {
        id: "fix-report",
        kind: "summary",
        retention: "session",
        exposeToMainContext: true,
        redaction: {
          status: "none",
          summary: "Minimal fix plus before/after evidence.",
        },
      },
    ],
    verification: {
      mode: "required",
      workflow: "debug",
      requiredArtifactIds: ["before-signal", "after-signal"],
    },
    synthesis: {
      agent: "synthesizer",
      outputFormat: "findings",
      exposeToMainContext: true,
      requiredArtifactIds: ["fix-report"],
    },
    phases: [
      {
        id: "reproduce",
        name: "Reproduce",
        kind: "sequential",
        agent: "planner",
        prompt:
          "Identify the smallest check that demonstrates the issue. Run it before any edit. Record command, input, observed result, and expected result in the before-signal artifact. Stop if the failure cannot be reproduced.",
        outputs: ["before-signal"],
      },
      {
        id: "implement",
        name: "Implement",
        kind: "sequential",
        agent: "worker",
        prompt:
          "Apply the smallest change that addresses the reproduced failure. Do not refactor neighbors. Follow the verified-change skill.",
        dependsOn: ["reproduce"],
      },
      {
        id: "recheck",
        name: "Recheck",
        kind: "verification",
        agent: "verifier",
        prompt:
          "Re-run the exact before-signal command. It must now pass. Record output in after-signal. If it still fails, do not mark the run successful.",
        dependsOn: ["implement"],
        outputs: ["after-signal"],
      },
      {
        id: "report",
        name: "Report",
        kind: "synthesis",
        agent: "synthesizer",
        prompt:
          "Summarize the reproduced failure, files changed, and before/after commands. Do not claim success if after-signal failed.",
        dependsOn: ["recheck"],
        outputs: ["fix-report"],
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

export function getParsedWorkflowFixtureSpec(name: WorkflowFixtureName): WorkflowSpecV1 {
  return WorkflowSpecV1Schema.parse(WorkflowFixtureSpecs[name])
}
