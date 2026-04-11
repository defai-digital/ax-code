// @ts-nocheck
import * as mod from "./session-rollback"
import { create } from "../storybook/scaffold"

const points = [
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
  {
    step: 3,
    messageID: "msg_3",
    partID: "prt_3",
    duration: 12000,
    tokens: { input: 45, output: 18 },
    tools: ["bash: bun test", "read: rollback.ts", "edit: rollback.ts", "write: notes.md"],
  },
]

const story = create({ title: "UI/SessionRollback", mod, args: { points, selectedStep: 2, actionLabel: "target" } })
export default { title: "UI/SessionRollback", id: "components-session-rollback", component: story.meta.component }
export const Basic = story.Basic
