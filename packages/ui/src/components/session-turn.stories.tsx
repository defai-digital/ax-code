// @ts-nocheck
import { DataProvider } from "../context/data"
import { DialogProvider } from "../context/dialog"
import { FileComponentProvider } from "../context/file"
import { SessionTurn } from "./session-turn"

const sessionID = "session_demo"
const userID = "message_user"
const assistantID = "message_assistant"

const messages = [
  {
    id: userID,
    sessionID,
    role: "user",
    agent: "core",
    model: { providerID: "openai", modelID: "gpt-5.4" },
    time: { created: Date.parse("2026-04-11T12:00:00Z") },
    summary: {
      diffs: [
        {
          file: "src/session/rollback.ts",
          status: "modified",
          additions: 14,
          deletions: 2,
          before: "export function rollback() {\n  return null\n}\n",
          after: "export function rollback() {\n  return detail(points)\n}\n",
        },
      ],
    },
  },
  {
    id: assistantID,
    sessionID,
    role: "assistant",
    parentID: userID,
    time: {
      created: Date.parse("2026-04-11T12:00:05Z"),
      completed: Date.parse("2026-04-11T12:00:17Z"),
    },
  },
]

const data = {
  session: [],
  session_status: {},
  session_diff: {},
  message: { [sessionID]: messages },
  part: {
    [userID]: [
      {
        id: "part_user_text",
        sessionID,
        messageID: userID,
        type: "text",
        text: "Make rollback decisions visible and explain why one branch is safer.",
      },
    ],
    [assistantID]: [
      {
        id: "part_assistant_text",
        sessionID,
        messageID: assistantID,
        type: "text",
        text: "Added step-level rollback points, DRE summaries, and branch ranking with recommendations.",
      },
    ],
  },
}

const insights = {
  dre: {
    detail: {
      level: "MEDIUM",
      score: 35,
      summary: "4 files changed, no validation run recorded",
      stats: "2 steps · 1 route · 3 tool calls",
      decision: "decision 0.66 · correctness 0.75 · safety 0.65",
      plan: "delegated inspect-first incremental edit",
      notes: ["validation not recorded"],
      drivers: ["Validation coverage · no validation run recorded", "File churn · 4 files changed"],
      scorecard: {
        total: 0.66,
        breakdown: [
          {
            key: "correctness",
            label: "Correctness",
            value: 0.75,
            detail: "validation not recorded, 0 divergences, 0 tool failures",
          },
          { key: "safety", label: "Safety", value: 0.65, detail: "risk 35/100" },
          {
            key: "simplicity",
            label: "Simplicity",
            value: 0.71,
            detail: "4 files, 80 lines, 3 tool calls, 1 route",
          },
          { key: "validation", label: "Validation", value: 0.45, detail: "validation not recorded" },
        ],
      },
      duration: 12000,
      tokens: { input: 120, output: 45 },
      routes: [{ from: "build", to: "debug", confidence: 0.92 }],
      tools: ["read", "grep", "edit"],
      counts: [
        { type: "tool.call", count: 3 },
        { type: "agent.route", count: 1 },
      ],
    },
    timeline: [
      { kind: "heading", text: "Duration 12s · Risk medium (35/100) · Tokens 120/45" },
      { kind: "meta", text: "Start (build)" },
      { kind: "route", text: "build → debug (confidence 0.92)" },
      { kind: "step", text: "Step 1 · 12s · tokens 120/45" },
      { kind: "tool", text: "read: demo.ts → ok (20ms)" },
      { kind: "tool", text: "edit: demo.ts → ok (40ms)" },
    ],
  },
  graph: {
    sessionID,
    nodes: [
      { id: "session-start", type: "session", label: "Start (build)", timestamp: 1 },
      { id: "route-1", type: "agent_route", label: "build → debug", timestamp: 2, confidence: 0.92 },
      { id: "step-1", type: "step", label: "Step #1", timestamp: 3, stepIndex: 1, duration: 800, tokens: { input: 20, output: 40 } },
      { id: "call-1", type: "tool_call", label: "read: demo.ts", timestamp: 4, callID: "1", tool: "read" },
      { id: "result-1", type: "tool_result", label: "read ok", timestamp: 5, duration: 30, status: "ok", callID: "1", tool: "read" },
      { id: "llm-1", type: "llm", label: "LLM stop (120ms)", timestamp: 6, duration: 120, tokens: { input: 20, output: 40 } },
      { id: "error-1", type: "error", label: "ToolError: boom", timestamp: 7, status: "error" },
    ],
    edges: [
      { from: "session-start", to: "route-1", type: "sequence" },
      { from: "route-1", to: "step-1", type: "sequence" },
      { from: "step-1", to: "call-1", type: "step_contains" },
      { from: "call-1", to: "result-1", type: "call_result" },
      { from: "step-1", to: "llm-1", type: "step_contains" },
      { from: "step-1", to: "error-1", type: "step_contains" },
    ],
    metadata: {
      duration: 1200,
      tokens: { input: 20, output: 40 },
      risk: { level: "LOW", score: 10, summary: "minimal change" },
      agents: ["build", "debug"],
      tools: ["read"],
      steps: 1,
      errors: 1,
    },
  },
  topology: [
    { kind: "heading", text: "Duration 1s | Steps 1 | Tools 1 | Errors 1" },
    {
      kind: "path",
      text: "Critical path: Start (build) → build → debug → Step #1 → read: demo.ts → read ok → LLM stop (120ms) → ToolError: boom",
      nodes: ["Start (build)", "build → debug", "Step #1", "read: demo.ts", "read ok", "LLM stop (120ms)", "ToolError: boom"],
    },
    {
      kind: "step",
      stepIndex: 1,
      text: "Step 1 flow: read: demo.ts → read ok → LLM stop (120ms) → ToolError: boom",
      nodes: ["read: demo.ts", "read ok", "LLM stop (120ms)", "ToolError: boom"],
    },
    {
      kind: "pair",
      text: "Call/result: read: demo.ts → read ok",
      call: "read: demo.ts",
      result: "read ok",
    },
  ],
  compare: {
    session1: {
      id: "ses_safe",
      title: "safe branch",
      risk: {
        level: "LOW",
        score: 12,
        signals: {
          filesChanged: 1,
          linesChanged: 18,
          testCoverage: 1,
          apiEndpointsAffected: 0,
          crossModule: false,
          securityRelated: false,
          validationPassed: true,
          toolFailures: 0,
          totalTools: 2,
        },
        summary: "minimal change",
        breakdown: [],
      },
      decision: { total: 0.97, breakdown: [] },
      events: 8,
      plan: "inspect-first incremental edit",
      headline: "decision 0.97 · correctness 0.95 · safety 0.88",
    },
    session2: {
      id: "ses_risky",
      title: "rewrite branch",
      risk: {
        level: "HIGH",
        score: 74,
        signals: {
          filesChanged: 4,
          linesChanged: 180,
          testCoverage: 0,
          apiEndpointsAffected: 1,
          crossModule: true,
          securityRelated: false,
          validationPassed: false,
          toolFailures: 1,
          totalTools: 3,
        },
        summary: "broad change",
        breakdown: [],
      },
      decision: { total: 0.44, breakdown: [] },
      events: 11,
      plan: "delegated inspect-first multi-file edit",
      headline: "decision 0.44 · correctness 0.25 · safety 0.26",
    },
    differences: {
      toolChainDiffers: true,
      routeDiffers: true,
      eventCountDelta: 3,
    },
    advisory: {
      winner: "A",
      confidence: 0.83,
      reasons: ["lower risk", "higher decision score", "validation passed"],
    },
    analysis: {
      session1: {
        tools: ["read", "edit"],
        routes: [],
        counts: {},
        plan: "inspect-first incremental edit",
        notes: ["validation passed"],
        decision: { total: 0.97, breakdown: [] },
        headline: "decision 0.97",
      },
      session2: {
        tools: ["read", "edit", "bash"],
        routes: [{ from: "build", to: "debug", confidence: 0.91 }],
        counts: {},
        plan: "delegated inspect-first multi-file edit",
        notes: ["validation failed"],
        decision: { total: 0.44, breakdown: [] },
        headline: "decision 0.44",
      },
    },
    replay: {
      session1: { stepsCompared: 1, divergences: 0, reasons: [] },
      session2: { stepsCompared: 1, divergences: 2, reasons: ["tool call mismatch", "validation failed"] },
    },
  },
  rollback: [
    {
      step: 1,
      messageID: "msg_1",
      partID: "prt_1",
      duration: 3200,
      tokens: { input: 18, output: 6 },
      tools: ["read: demo.ts"],
    },
    {
      step: 2,
      messageID: "msg_2",
      partID: "prt_2",
      duration: 8400,
      tokens: { input: 32, output: 12 },
      tools: ["read: demo.ts", "grep: validate", "edit: demo.ts"],
    },
  ],
  leftLabel: "A",
  rightLabel: "B",
  selectedStep: 2,
  actionLabel: "target",
}

function FileStub(props) {
  return (
    <pre style={{ margin: 0, padding: "12px", overflow: "auto", "font-size": "12px" }}>
      {props.after?.contents ?? props.before?.contents ?? ""}
    </pre>
  )
}

function render(args) {
  return (
    <div style={{ height: "720px", padding: "24px" }}>
      <DialogProvider>
        <FileComponentProvider component={FileStub}>
          <DataProvider data={data} directory="/workspace/demo">
            <SessionTurn {...args} />
          </DataProvider>
        </FileComponentProvider>
      </DialogProvider>
    </div>
  )
}

export default {
  title: "UI/SessionTurn",
  id: "components-session-turn",
  component: SessionTurn,
  render,
  args: {
    sessionID,
    messageID: userID,
    messages,
    active: false,
  },
}

export const Basic = {}

export const WithInsights = {
  args: {
    insights,
  },
}
