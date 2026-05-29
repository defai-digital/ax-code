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

export type AppFixtureScenarioName =
  | "idle-session"
  | "streaming-session"
  | "permission-block"
  | "question-block"
  | "failed-task"
  | "queued-followup"
  | "worktree-task"
  | "review-artifacts"
  | "reconnect-recovery"

export type AppFixtureScenario = {
  name: AppFixtureScenarioName
  title: string
  description: string
  events: AppHeadlessEvent[]
  selectedSessionID: string
  queue?: AppQueueItem[]
  evidence?: Record<string, AppSessionEvidence>
  catalog?: AppRuntimeCatalog
  worktrees?: AppWorktree[]
  terminals?: AppTerminal[]
  scheduledTasks?: AppScheduledTask[]
}

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
    type: "permission.asked",
    properties: {
      id: "perm_arch_browser",
      sessionID: "ses_architecture",
      permission: "webfetch",
      patterns: ["http://127.0.0.1:3000"],
      metadata: { reason: "Verify local browser preview" },
      always: [],
      tool: {
        messageID: "msg_assistant_architecture",
        callID: "call_browser_preview",
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
    branchRank: {
      currentID: "ses_architecture",
      recommendedID: "ses_architecture",
      recommendedTitle: "Desktop app architecture",
      confidence: 0.82,
      reasons: ["Best validation coverage", "Lowest permission boundary risk"],
      items: [
        {
          id: "ses_architecture",
          title: "Desktop app architecture",
          current: true,
          recommended: true,
          headline: "Contract-first app shell is reviewable",
          riskLevel: "MEDIUM",
          riskScore: 42,
          decisionScore: 84,
        },
        {
          id: "ses_queue",
          title: "Server-owned task queue",
          current: false,
          recommended: false,
          headline: "Queue contract needs blocker validation",
          riskLevel: "HIGH",
          riskScore: 67,
          decisionScore: 71,
        },
      ],
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
    artifactPreviews: {
      findings: [
        {
          id: "finding-ipc-001",
          title: "Bridge command allowlist needs review",
          status: "medium",
          detail: "packages/desktop/src/bridge/schema.ts",
        },
      ],
      verificationEnvelopes: [
        {
          id: "env-app-test",
          title: "App test suite",
          status: "passed",
          detail: "pnpm --dir packages/app run test",
        },
        {
          id: "env-desktop-test",
          title: "Desktop bridge tests",
          status: "passed",
          detail: "pnpm --dir packages/desktop run test",
        },
      ],
      reviewResults: [
        {
          id: "review-local",
          title: "Review pending",
          status: "needs_changes",
          detail: "Inspect desktop bridge and queue lifecycle before release.",
        },
      ],
      debugCases: [],
      decisionHints: [
        {
          id: "hint-review-verification",
          title: "Run review-scoped verification",
          status: "missing_verification",
          detail: "Review artifacts should cite a passing verification envelope.",
        },
      ],
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
    {
      id: "local",
      label: "Local model server",
      source: "localhost",
      modelCount: 0,
      status: "no_models",
      reason: "No models returned by backend",
    },
  ],
  agents: [
    { id: "build", label: "Build", mode: "primary" },
    { id: "review", label: "Review", mode: "primary" },
    { id: "debug", label: "Debug", mode: "primary" },
  ],
  skills: [
    {
      name: "debug-n-fix",
      description: "Debug and repair a failing workflow with verification evidence.",
      location: "builtin://skills/debug-n-fix/SKILL.md",
      builtin: true,
      status: "ok",
      issues: [],
    },
    {
      name: "release-review",
      description: "Review release readiness and collect follow-up validation.",
      location: "/workspace/ax-code/.ax-code/skill/release-review/SKILL.md",
      status: "warn",
      issues: ["missing compatibility metadata"],
    },
  ],
  models: [
    { providerID: "openai", modelID: "gpt-5-codex", label: "OpenAI · gpt-5-codex" },
    { providerID: "anthropic", modelID: "claude-sonnet-4-5", label: "Anthropic · claude-sonnet-4-5" },
  ],
  mcp: {
    total: 3,
    connected: 1,
    disabled: 1,
    failed: 0,
    needsAuth: 1,
    needsTrust: 0,
  },
  lsp: {
    total: 2,
    connected: 2,
    error: 0,
  },
  codeIndex: {
    pendingPlans: 1,
    toolCount: 6,
    nodeCount: 420,
    edgeCount: 780,
    state: "idle",
    completed: 12,
    total: 12,
    lastIndexedAt: 1_780_000_000_000,
  },
  permission: {
    totalRules: 4,
    allow: 1,
    ask: 2,
    deny: 1,
    strictUnknown: true,
  },
}

export const fixtureWorktrees: AppWorktree[] = [
  { directory: "/workspace/ax-code", name: "primary", branch: "feature/codex-like-app" },
  { directory: "/workspace/.ax-code/worktrees/wt-app-shell", name: "wt-app-shell", branch: "ax-code/wt-app-shell" },
  {
    directory: "/workspace/.ax-code/worktrees/wt-queue-contract",
    name: "wt-queue-contract",
    branch: "ax-code/wt-queue-contract",
  },
]

export const fixtureTerminals: AppTerminal[] = [
  {
    id: "pty_fixture_dev",
    title: "Dev server",
    command: "pnpm dev",
    cwd: "/workspace/ax-code",
    status: "running",
    sessionID: "ses_architecture",
    sessionTitle: "Design desktop command center",
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
    lastRunAt: now - 3_600_000,
    lastQueueID: "queue_fixture_scheduled_review",
    lastSessionID: "ses_architecture",
    lastDurationMs: 92_000,
    error: "Last run requested follow-up review",
    nextRunAt: now + 54_000_000,
  },
]

export const fixtureSelectedSessionID = "ses_architecture"

export const fixtureScenarios: AppFixtureScenario[] = [
  {
    name: "idle-session",
    title: "Idle session",
    description: "Baseline connected backend with an idle session and no queue pressure.",
    selectedSessionID: "ses_fixture_idle",
    events: [
      { type: "server.connected", properties: {} },
      scenarioSession("ses_fixture_idle", "Idle command center", now + 10),
      scenarioStatus("ses_fixture_idle", { type: "idle" }),
      ...scenarioText("ses_fixture_idle", "msg_idle_user", "user", "Inspect the current repository state.", now + 20),
    ],
    queue: [],
  },
  {
    name: "streaming-session",
    title: "Streaming session",
    description: "Assistant output arrives through message part deltas while the session is busy.",
    selectedSessionID: "ses_fixture_streaming",
    events: [
      { type: "server.connected", properties: {} },
      scenarioSession("ses_fixture_streaming", "Streaming output", now + 100),
      scenarioStatus("ses_fixture_streaming", { type: "busy", activeTool: "generate", waitState: "llm", step: 1 }),
      {
        type: "message.updated",
        properties: {
          info: {
            id: "msg_streaming_assistant",
            sessionID: "ses_fixture_streaming",
            role: "assistant",
            createdAt: now + 120,
          },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part_streaming_assistant",
            messageID: "msg_streaming_assistant",
            type: "text",
            text: "",
          },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          messageID: "msg_streaming_assistant",
          partID: "part_streaming_assistant",
          field: "text",
          delta: "Streaming ",
        },
      },
      {
        type: "message.part.delta",
        properties: {
          messageID: "msg_streaming_assistant",
          partID: "part_streaming_assistant",
          field: "text",
          delta: "response",
        },
      },
    ],
    queue: [
      scenarioQueue("queue_fixture_streaming", "Stream assistant output", "prompt", "running", "ses_fixture_streaming"),
    ],
  },
  {
    name: "permission-block",
    title: "Permission block",
    description: "Session is blocked on an explicit permission request with always rules available.",
    selectedSessionID: "ses_fixture_permission",
    events: [
      { type: "server.connected", properties: {} },
      scenarioSession("ses_fixture_permission", "Permission approval", now + 200),
      scenarioStatus("ses_fixture_permission", { type: "blocked", reason: "permission" }),
      {
        type: "permission.asked",
        properties: {
          id: "perm_fixture_write",
          sessionID: "ses_fixture_permission",
          permission: "write",
          patterns: ["packages/app/src/fixtures/headless.ts"],
          metadata: { reason: "Update canonical fixture catalog" },
          always: ["packages/app/src/fixtures/headless.ts"],
          tool: { messageID: "msg_fixture_permission_tool", callID: "call_fixture_permission" },
        },
      },
    ],
    queue: [
      scenarioQueue(
        "queue_fixture_permission",
        "Update fixture catalog",
        "prompt",
        "blocked_permission",
        "ses_fixture_permission",
      ),
    ],
  },
  {
    name: "question-block",
    title: "Question block",
    description: "Session is blocked on a structured user question.",
    selectedSessionID: "ses_fixture_question",
    events: [
      { type: "server.connected", properties: {} },
      scenarioSession("ses_fixture_question", "Question approval", now + 300),
      scenarioStatus("ses_fixture_question", { type: "blocked", reason: "question" }),
      {
        type: "question.asked",
        properties: {
          id: "q_fixture_release_scope",
          sessionID: "ses_fixture_question",
          questions: [
            {
              header: "Scope",
              question: "Should public release gates block internal beta?",
              options: [
                { label: "Warn only", description: "Internal beta can continue with explicit warnings." },
                { label: "Block beta", description: "Beta waits for public signing and notarization." },
              ],
              custom: true,
            },
          ],
        },
      },
    ],
    queue: [
      scenarioQueue(
        "queue_fixture_question",
        "Resolve beta scope",
        "prompt",
        "blocked_question",
        "ses_fixture_question",
      ),
    ],
  },
  {
    name: "failed-task",
    title: "Failed task",
    description: "Queue and session both expose a failed state with an error payload.",
    selectedSessionID: "ses_fixture_failed",
    events: [
      { type: "server.connected", properties: {} },
      scenarioSession("ses_fixture_failed", "Failed verification", now + 400),
      scenarioStatus("ses_fixture_failed", { type: "failed", message: "Typecheck failed" }),
      {
        type: "session.error",
        properties: { sessionID: "ses_fixture_failed", error: { message: "Typecheck failed" } },
      },
      {
        type: "task.queue.created",
        properties: {
          item: scenarioQueue("queue_fixture_failed", "Run verification", "command", "failed", "ses_fixture_failed"),
        },
      },
    ],
  },
  {
    name: "queued-followup",
    title: "Queued follow-up",
    description: "A queued follow-up preserves source task and source message identity.",
    selectedSessionID: "ses_fixture_followup",
    events: [
      { type: "server.connected", properties: {} },
      scenarioSession("ses_fixture_followup", "Follow-up queue", now + 500),
      scenarioStatus("ses_fixture_followup", { type: "idle" }),
      {
        type: "task.queue.created",
        properties: {
          item: {
            ...scenarioQueue(
              "queue_fixture_followup",
              "Verify docs after implementation",
              "followup",
              "queued",
              "ses_fixture_followup",
            ),
            sourceMessageID: "msg_fixture_followup_source",
            sourceTaskID: "queue_fixture_parent",
          },
        },
      },
    ],
  },
  {
    name: "worktree-task",
    title: "Worktree task",
    description: "Queue item targets an isolated worktree and branch returned by backend-visible metadata.",
    selectedSessionID: "ses_fixture_worktree",
    events: [
      { type: "server.connected", properties: {} },
      { type: "vcs.branch.updated", properties: { branch: "ax-code/fixture-worktree" } },
      scenarioSession("ses_fixture_worktree", "Worktree implementation", now + 600, "wt-fixture"),
      scenarioStatus("ses_fixture_worktree", { type: "busy", activeTool: "bash", waitState: "tool", step: 3 }),
      {
        type: "task.queue.created",
        properties: {
          item: {
            ...scenarioQueue(
              "queue_fixture_worktree",
              "Implement in isolated branch",
              "prompt",
              "running",
              "ses_fixture_worktree",
            ),
            directory: "/workspace/.ax-code/worktrees/wt-fixture",
            worktree: "wt-fixture",
            payload: { source: "fixture", text: "Run worktree task", worktree: "wt-fixture" },
          },
        },
      },
    ],
    worktrees: [
      { directory: "/workspace/ax-code", name: "primary", branch: "feature/codex-like-app" },
      { directory: "/workspace/.ax-code/worktrees/wt-fixture", name: "wt-fixture", branch: "ax-code/fixture-worktree" },
    ],
  },
  {
    name: "review-artifacts",
    title: "Review artifacts",
    description: "Review evidence contains renderer-safe findings, verification envelopes, and decision hints.",
    selectedSessionID: "ses_fixture_review",
    events: [
      { type: "server.connected", properties: {} },
      scenarioSession("ses_fixture_review", "Review artifacts", now + 700),
      scenarioStatus("ses_fixture_review", { type: "idle" }),
      {
        type: "task.queue.created",
        properties: {
          item: scenarioQueue(
            "queue_fixture_review",
            "Review implementation evidence",
            "review",
            "completed",
            "ses_fixture_review",
          ),
        },
      },
    ],
    evidence: {
      ses_fixture_review: {
        sessionID: "ses_fixture_review",
        status: "ready",
        risk: {
          level: "LOW",
          score: 18,
          confidence: 0.88,
          readiness: "ready",
          summary: "Fixture evidence is complete enough for renderer review.",
          drivers: ["fixture coverage", "verification envelope"],
        },
        semantic: {
          headline: "Canonical fixture scenarios added",
          risk: "low",
          primary: "test",
          files: 3,
          additions: 180,
          deletions: 0,
          changes: [
            {
              file: "packages/app/src/fixtures/headless.ts",
              summary: "Adds named canonical fixture streams",
              risk: "low",
            },
          ],
        },
        rollbackPoints: [],
        artifactCounts: {
          findings: 1,
          verificationEnvelopes: 1,
          reviewResults: 1,
          debugCases: 1,
          decisionHints: 1,
        },
        artifactPreviews: {
          findings: [{ id: "finding-fixture", title: "Fixture stream coverage", status: "low" }],
          verificationEnvelopes: [{ id: "env-fixture", title: "Fixture replay test", status: "passed" }],
          reviewResults: [{ id: "review-fixture", title: "Renderer-safe previews", status: "accepted" }],
          debugCases: [{ id: "debug-fixture", title: "Reconnect replay", status: "covered" }],
          decisionHints: [{ id: "hint-fixture", title: "Keep fixtures contract-owned", status: "accepted" }],
        },
        errors: [],
      },
    },
  },
  {
    name: "reconnect-recovery",
    title: "Reconnect recovery",
    description: "Stream controls include heartbeat, backend disposal, and post-reconnect session reconstruction.",
    selectedSessionID: "ses_fixture_reconnect",
    events: [
      { type: "server.connected", properties: {} },
      scenarioSession("ses_fixture_reconnect", "Reconnect recovery", now + 800),
      scenarioStatus("ses_fixture_reconnect", { type: "busy", activeTool: "event-stream", waitState: "tool" }),
      { type: "server.heartbeat", properties: {} },
      { type: "server.instance.disposed" },
      { type: "server.connected", properties: {} },
      scenarioSession("ses_fixture_reconnect", "Reconnect recovery", now + 900),
      scenarioStatus("ses_fixture_reconnect", { type: "idle" }),
      ...scenarioText(
        "ses_fixture_reconnect",
        "msg_reconnect_assistant",
        "assistant",
        "Projection recovered after reconnect.",
        now + 920,
      ),
    ],
  },
]

const fixtureScenarioMap = new Map(fixtureScenarios.map((scenario) => [scenario.name, scenario]))

export function fixtureScenarioByName(name: AppFixtureScenarioName): AppFixtureScenario {
  const scenario = fixtureScenarioMap.get(name)
  if (!scenario) throw new Error(`Unknown fixture scenario: ${name}`)
  return scenario
}

function scenarioSession(id: string, title: string, updatedAt: number, worktree?: string): AppHeadlessEvent {
  return {
    type: "session.created",
    properties: {
      info: {
        id,
        title,
        project: "ax-code",
        worktree,
        updatedAt,
      },
    },
  }
}

function scenarioStatus(sessionID: string, status: AppHeadlessEventOf<"session.status">["properties"]["status"]) {
  return {
    type: "session.status",
    properties: { sessionID, status },
  } satisfies AppHeadlessEvent
}

function scenarioText(
  sessionID: string,
  messageID: string,
  role: "user" | "assistant",
  text: string,
  createdAt: number,
): AppHeadlessEvent[] {
  return [
    {
      type: "message.updated",
      properties: {
        info: {
          id: messageID,
          sessionID,
          role,
          createdAt,
        },
      },
    },
    {
      type: "message.part.updated",
      properties: {
        part: {
          id: `${messageID}_part`,
          messageID,
          type: "text",
          text,
        },
      },
    },
  ]
}

function scenarioQueue(
  id: string,
  title: string,
  kind: AppQueueItem["kind"],
  status: AppQueueItem["status"],
  sessionID: string,
): AppQueueItem {
  return {
    id,
    project: "ax-code",
    sessionID,
    title,
    kind,
    status,
    priority: 10,
    createdAt: now,
    payload: { source: "fixture", text: title },
  }
}

type AppHeadlessEventOf<TType extends AppHeadlessEvent["type"]> = Extract<AppHeadlessEvent, { type: TType }>
