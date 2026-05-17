import { describe, expect, test } from "bun:test"
import type { ToolPart } from "@ax-code/sdk/v2"
import { contextToolTrigger, getToolInfo } from "./message-part.tools"

function t(key: string, params?: Record<string, string | number>) {
  if (key === "ui.tool.agent") return `agent:${params?.type}`
  return key
}

function tool(
  tool: string,
  input: Record<string, unknown>,
  status: ToolPart["state"]["status"] = "completed",
): ToolPart {
  if (status === "pending") {
    return {
      id: "part_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool,
      state: {
        status,
        input,
        raw: "",
      },
    }
  }

  if (status === "running") {
    return {
      id: "part_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool,
      state: {
        status,
        input,
        time: { start: 1 },
      },
    }
  }

  if (status === "error") {
    return {
      id: "part_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool,
      state: {
        status,
        input,
        error: "boom",
        time: { start: 1, end: 2 },
      },
    }
  }

  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool,
    state: {
      status,
      input,
      output: "ok",
      title: "done",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  }
}

describe("message-part.tools", () => {
  test("formats tool info for file and task tools", () => {
    expect(getToolInfo("read", { filePath: "/repo/src/app.ts" }, t)).toEqual({
      icon: "glasses",
      title: "ui.tool.read",
      subtitle: "app.ts",
    })

    expect(getToolInfo("task", { subagent_type: "reviewer", description: "inspect" }, t)).toEqual({
      icon: "task",
      title: "agent:Reviewer",
      subtitle: "inspect",
    })
  })

  test("formats apply_patch file counts", () => {
    expect(getToolInfo("apply_patch", { files: ["a.ts"] }, t).subtitle).toBe("1 ui.common.file.one")
    expect(getToolInfo("apply_patch", { files: ["a.ts", "b.ts"] }, t).subtitle).toBe("2 ui.common.file.other")
  })

  test("builds context tool triggers for read and grep tools", () => {
    expect(
      contextToolTrigger(
        tool("read", { filePath: "/repo/src/app.ts", offset: 10, limit: 20 }),
        t,
        (path) => path ?? "",
      ),
    ).toEqual({
      title: "ui.tool.read",
      subtitle: "app.ts",
      args: ["offset=10", "limit=20"],
    })

    expect(
      contextToolTrigger(
        tool("grep", { path: "/repo/src", pattern: "todo", include: "*.ts" }),
        t,
        (path) => `dir:${path}`,
      ),
    ).toEqual({
      title: "ui.tool.grep",
      subtitle: "dir:/repo/src",
      args: ["pattern=todo", "include=*.ts"],
    })
  })

  test("falls back to error or title details for other tools", () => {
    expect(contextToolTrigger(tool("skill", { name: "docs" }), t, (path) => path ?? "")).toEqual({
      title: "docs",
      subtitle: "done",
      args: [],
    })

    expect(contextToolTrigger(tool("skill", {}, "error"), t, (path) => path ?? "")).toEqual({
      title: "ui.tool.skill",
      subtitle: "boom",
      args: [],
    })
  })
})
