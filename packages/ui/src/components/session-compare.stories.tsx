// @ts-nocheck
import * as mod from "./session-compare"
import { create } from "../storybook/scaffold"

const result = {
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
}

const story = create({ title: "UI/SessionCompare", mod, args: { result } })
export default { title: "UI/SessionCompare", id: "components-session-compare", component: story.meta.component }
export const Basic = story.Basic
