import type {
  AppHeadlessEvent,
  AppQueueItem,
  AppRuntimeCatalog,
  AppScheduledTask,
  AppSessionEvidence,
  AppTerminal,
  AppWorktree,
} from "../projection/types"

const now = Date.parse("2026-05-28T18:00:00Z")

export const fixtureHeadlessEvents: AppHeadlessEvent[] = [
  { type: "server.connected", properties: {} },
  { type: "vcs.branch.updated", properties: { branch: "feature/codex-like-app" } },
  {
    type: "session.created",
    properties: {
      info: {
        id: "ses_architecture",
        title: "Desktop app architecture",
        project: "ax-code",
        worktree: "wt-app-shell",
        updatedAt: now,
      },
    },
  },
  {
    type: "session.created",
    properties: {
      info: {
        id: "ses_queue",
        title: "Server-owned task queue",
        project: "ax-code",
        worktree: "wt-queue-contract",
        updatedAt: now + 2000,
      },
    },
  },
  {
    type: "session.status",
    properties: {
      sessionID: "ses_architecture",
      status: { type: "busy", activeTool: "apply_patch", waitState: "tool", step: 2, maxSteps: 6 },
    },
  },
  {
    type: "session.status",
    properties: {
      sessionID: "ses_queue",
      status: { type: "blocked", reason: "permission" },
    },
  },
  {
    type: "message.updated",
    properties: {
      info: {
        id: "msg_user_architecture",
        sessionID: "ses_architecture",
        role: "user",
        createdAt: now + 100,
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      part: {
        id: "part_user_architecture",
        messageID: "msg_user_architecture",
        type: "text",
        text: "Implement the PRD with OpenChamber as product baseline and AX Code as runtime boundary.",
      },
    },
  },
  {
    type: "message.updated",
    properties: {
      info: {
        id: "msg_assistant_architecture",
        sessionID: "ses_architecture",
        role: "assistant",
        createdAt: now + 1000,
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      part: {
        id: "part_assistant_architecture",
        messageID: "msg_assistant_architecture",
        type: "text",
        text: "Building the fixture-driven command center and desktop trust boundary first.",
      },
    },
  },
  {
    type: "todo.updated",
    properties: {
      sessionID: "ses_architecture",
      todos: [
        { id: "todo_contracts", text: "Define SDK projection fixture replay", status: "completed" },
        { id: "todo_desktop", text: "Add desktop bridge security baseline", status: "in_progress" },
        { id: "todo_lifecycle", text: "Wire sidecar lifecycle", status: "pending" },
      ],
    },
  },
  {
    type: "session.diff",
    properties: {
      sessionID: "ses_architecture",
      diff: [
        { path: "packages/app/src/App.tsx", added: 180, removed: 0 },
        { path: "packages/desktop/src/bridge/schema.ts", added: 120, removed: 0 },
      ],
    },
  },
  {
    type: "session.diff",
    properties: {
      sessionID: "ses_queue",
      diff: [
        { path: "packages/app/src/App.tsx", added: 44, removed: 8 },
        { path: "packages/ax-code/src/session/task-queue-executor.ts", added: 160, removed: 20 },
      ],
    },
  },
  {
    type: "session.goal",
    properties: {
      sessionID: "ses_architecture",
      goal: {
        objective: "Ship a first-party AX Code command center",
        status: "active",
        remainingTokens: 64000,
      },
    },
  },
  {
    type: "permission.asked",
    properties: {
      id: "perm_queue_storage",
      sessionID: "ses_queue",
      permission: "write",
      patterns: ["packages/ax-code/src/session/task-queue.ts"],
      metadata: { reason: "Create server-owned queue contract" },
      always: [],
      tool: {
        messageID: "msg_queue_tool",
        callID: "call_queue_storage",
      },
    },
  },
  {
    type: "question.asked",
    properties: {
      id: "q_protocol",
      sessionID: "ses_architecture",
      questions: [
        {
          header: "App Protocol",
          question: "Should packaged desktop prefer custom app protocol or trusted loopback origin first?",
          options: [
            { label: "Custom protocol", description: "Best default for packaged local shell." },
            { label: "Loopback", description: "Simpler during development and attach mode." },
          ],
          custom: true,
        },
      ],
    },
  },
]

export const fixtureQueueItems: AppQueueItem[] = [
  {
    id: "queue_app_shell",
    project: "ax-code",
    directory: "/workspace/.ax-code/worktrees/wt-app-shell",
    sessionID: "ses_architecture",
    title: "Build fixture command center shell",
    kind: "prompt",
    status: "running",
    priority: 10,
    payload: {
      source: "fixture",
      text: "Compare app shell variants",
      multiRunID: "multirun_fixture_app",
      multiRunIndex: 1,
      multiRunCount: 2,
      worktree: "wt-app-shell",
    },
    createdAt: now,
  },
  {
    id: "queue_queue_contract",
    project: "ax-code",
    directory: "/workspace/.ax-code/worktrees/wt-queue-contract",
    sessionID: "ses_queue",
    title: "Draft durable queue storage contract",
    kind: "followup",
    status: "blocked_permission",
    priority: 20,
    payload: {
      source: "fixture",
      text: "Compare app shell variants",
      multiRunID: "multirun_fixture_app",
      multiRunIndex: 2,
      multiRunCount: 2,
      worktree: "wt-queue-contract",
    },
    createdAt: now + 500,
  },
  {
    id: "queue_review_panel",
    project: "ax-code",
    directory: "/workspace/ax-code",
    sessionID: "ses_architecture",
    title: "Add DRE and rollback review panel",
    kind: "review",
    status: "queued",
    priority: 30,
    createdAt: now + 1000,
  },
]

export const fixtureSessionEvidence: Record<string, AppSessionEvidence> = {
  ses_architecture: {
    sessionID: "ses_architecture",
    status: "ready",
    risk: {
      level: "MEDIUM",
      score: 42,
      confidence: 0.76,
      readiness: "needs_review",
      summary: "New app and desktop boundaries require focused review before packaging.",
      drivers: ["desktop IPC bridge", "server-owned queue storage"],
    },
    semantic: {
      headline: "Adds desktop app shell and durable queue contract",
      risk: "medium",
      primary: "api",
      files: 12,
      additions: 940,
      deletions: 20,
      changes: [
        {
          file: "packages/app/src/App.tsx",
          summary: "Adds command-center layout and supervised queue controls",
          risk: "medium",
        },
        {
          file: "packages/desktop/src/bridge/schema.ts",
          summary: "Defines constrained native bridge commands",
          risk: "medium",
        },
      ],
    },
    dre: {
      decision: "Proceed with contract-first implementation and keep host capabilities narrow.",
      summary: "The current slice is reviewable because runtime actions stay behind public server routes.",
      readiness: "needs_review",
      timeline: ["Session created", "Fixture replay verified", "Desktop bridge checks passed"],
    },
    rollbackPoints: [
      {
        step: 2,
        messageID: "msg_assistant_architecture",
        partID: "part_step_architecture",
        durationMs: 1400,
        tokens: { input: 1200, output: 320 },
        tools: ["apply_patch: packages/app/src/App.tsx"],
        kinds: ["apply_patch"],
      },
    ],
    artifactCounts: {
      findings: 1,
      verificationEnvelopes: 2,
      reviewResults: 1,
      debugCases: 0,
      decisionHints: 2,
    },
    errors: [],
  },
}

export const fixtureRuntimeCatalog: AppRuntimeCatalog = {
  providers: [
    {
      id: "openai",
      label: "OpenAI",
      source: "env",
      modelCount: 1,
      defaultModelID: "gpt-5-codex",
      status: "available",
    },
    {
      id: "anthropic",
      label: "Anthropic",
      source: "env",
      modelCount: 1,
      defaultModelID: "claude-sonnet-4-5",
      status: "available",
    },
  ],
  agents: [
    { id: "build", label: "Build", mode: "primary" },
    { id: "review", label: "Review", mode: "primary" },
    { id: "debug", label: "Debug", mode: "primary" },
  ],
  models: [
    { providerID: "openai", modelID: "gpt-5-codex", label: "OpenAI · gpt-5-codex" },
    { providerID: "anthropic", modelID: "claude-sonnet-4-5", label: "Anthropic · claude-sonnet-4-5" },
  ],
}

export const fixtureWorktrees: AppWorktree[] = [
  { directory: "/workspace/ax-code", name: "primary" },
  { directory: "/workspace/.ax-code/worktrees/wt-app-shell", name: "wt-app-shell" },
  { directory: "/workspace/.ax-code/worktrees/wt-queue-contract", name: "wt-queue-contract" },
]

export const fixtureTerminals: AppTerminal[] = [
  {
    id: "pty_fixture_dev",
    title: "Dev server",
    command: "pnpm dev",
    cwd: "/workspace/ax-code",
    status: "running",
  },
]

export const fixtureScheduledTasks: AppScheduledTask[] = [
  {
    id: "sch_fixture_review",
    project: "ax-code",
    title: "Morning branch review",
    prompt: "Review the active branch and queue any follow-up verification.",
    schedule: { type: "daily", time: "09:00" },
    status: "active",
    agent: "review",
    nextRunAt: now + 54_000_000,
  },
]

export const fixtureSelectedSessionID = "ses_architecture"
