// Agent-level (L2) task matrix for the model-in-loop computer-use benchmark.
// Each task is a natural-language goal judged by an external post-condition —
// the agent decides its own step sequence (observe/act/plan), which is what
// makes this layer measure orchestration rather than primitives.

import type { AgentTaskSpec } from "./harness"

/** fixed deterministic marker, plain ASCII so text routing preserves it */
export const AG_BENCH_MARKER = "ax-bench-marker-1"
export const AG_BENCH_MARKER_2 = "ax-bench-marker-2"

export function agentTaskSet(): AgentTaskSpec[] {
  return [
    {
      id: "AG-001",
      name: "TextEdit: open, type marker, copy all",
      prompt: [
        "Use the computer tools to complete this GUI task on macOS:",
        `1. Launch TextEdit (computer_action launch_app).`,
        `2. Type exactly this text into the document: ${AG_BENCH_MARKER}`,
        "3. Select all (keypress cmd+a) and copy (keypress cmd+c).",
        "Stop when done. Do not save the document.",
      ].join(" "),
      verify: async (probes) => {
        const clip = await probes.readClipboard()
        return clip === undefined ? undefined : clip.includes(AG_BENCH_MARKER)
      },
    },
    {
      id: "AG-002",
      name: "Calculator: compute 2+3 and copy the result",
      prompt: [
        "Use the computer tools to complete this GUI task on macOS:",
        "1. Launch Calculator (computer_action launch_app).",
        "2. Compute 2 + 3 = using keypress actions (keys 2, +, 3, =).",
        "3. Copy the result (keypress cmd+c).",
        "Stop when done.",
      ].join(" "),
      verify: async (probes) => {
        const clip = await probes.readClipboard()
        return clip === undefined ? undefined : clip.trim() === "5"
      },
    },
    {
      id: "AG-003",
      name: "TextEdit: two markers across turns, verify mid-way",
      prompt: [
        "Use the computer tools to complete this GUI task on macOS:",
        `1. Launch TextEdit and type: ${AG_BENCH_MARKER}`,
        "2. Take a fresh computer_snapshot and confirm the text is visible.",
        `3. Type a second line: ${AG_BENCH_MARKER_2}`,
        "4. Select all (cmd+a) and copy (cmd+c).",
        "Stop when done. Do not save the document.",
      ].join(" "),
      verify: async (probes) => {
        const clip = await probes.readClipboard()
        return clip === undefined ? undefined : clip.includes(AG_BENCH_MARKER) && clip.includes(AG_BENCH_MARKER_2)
      },
    },
  ]
}
