// @ts-nocheck
import * as mod from "./session-dre"
import { create } from "../storybook/scaffold"

const snapshot = {
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
        { key: "simplicity", label: "Simplicity", value: 0.71, detail: "4 files, 80 lines, 3 tool calls, 1 route" },
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
}

const story = create({ title: "UI/SessionDre", mod, args: { snapshot } })
export default { title: "UI/SessionDre", id: "components-session-dre", component: story.meta.component }
export const Basic = story.Basic
