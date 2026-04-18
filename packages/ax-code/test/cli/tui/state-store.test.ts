import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Event, Part, Session, UserMessage } from "@ax-code/sdk/v2"
import { createTuiStateStore } from "../../../src/cli/cmd/tui/state/store"
import {
  activeSessionID,
  currentWorkspaceID,
  currentWorkspaceView,
  hasBlockingRequest,
  pendingPermission,
  pendingQuestion,
  promptValue,
  sessionStatusFor,
  sessionsForWorkspace,
  transcriptForSession,
} from "../../../src/cli/cmd/tui/state/selectors"

function session(input: Partial<Session> & Pick<Session, "id" | "directory">): Session {
  return {
    id: input.id,
    slug: input.slug ?? input.id,
    projectID: input.projectID ?? "proj_1",
    title: input.title ?? input.id,
    parentID: input.parentID,
    share: input.share,
    version: "v2",
    time: {
      created: input.time?.created ?? 1,
      updated: input.time?.updated ?? 1,
      compacting: input.time?.compacting,
    },
    revert: input.revert,
    permission: input.permission,
    summary: input.summary,
    directory: input.directory,
  }
}

function userMessage(input: Partial<UserMessage> & Pick<UserMessage, "id" | "sessionID">): UserMessage {
  return {
    id: input.id,
    sessionID: input.sessionID,
    role: "user",
    agent: input.agent ?? "codex",
    model: input.model ?? { providerID: "openai", modelID: "gpt-5.4" },
    system: input.system,
    time: {
      created: input.time?.created ?? 1,
    },
    format: input.format,
    summary: input.summary,
    tools: input.tools,
    variant: input.variant,
  }
}

function assistantMessage(
  input: Partial<AssistantMessage> & Pick<AssistantMessage, "id" | "sessionID" | "parentID">,
): AssistantMessage {
  return {
    id: input.id,
    sessionID: input.sessionID,
    role: "assistant",
    parentID: input.parentID,
    agent: input.agent ?? "codex",
    modelID: input.modelID ?? "gpt-5.4",
    providerID: input.providerID ?? "openai",
    mode: input.mode ?? "chat",
    path: input.path ?? { cwd: "/repo", root: "/repo" },
    tokens: input.tokens ?? {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    time: {
      created: input.time?.created ?? 1,
      completed: input.time?.completed,
    },
    error: input.error,
    cost: input.cost,
    summary: input.summary,
    structured: input.structured,
    variant: input.variant,
    finish: input.finish,
  }
}

function part(input: Partial<Part> & Pick<Part, "id" | "sessionID" | "messageID" | "type">): Part {
  if (input.type === "text") {
    return {
      id: input.id,
      sessionID: input.sessionID,
      messageID: input.messageID,
      type: "text",
      text: (input as Extract<Part, { type: "text" }>).text ?? "",
    }
  }
  throw new Error(`unsupported part fixture type: ${input.type}`)
}

describe("tui headless state store", () => {
  test("replays a session flow into workspace, transcript, permission, and question state", () => {
    const store = createTuiStateStore()

    store.dispatch({
      type: "bootstrap.hydrated",
      data: {
        workspaceList: ["/repo", "/repo-two"],
        path: {
          home: "/home/test",
          state: "/state",
          config: "/config",
          worktree: "/repo",
          directory: "/repo",
        },
      },
    })
    store.dispatch({ type: "workspace.selected", workspaceID: "/repo" })
    store.dispatchEvent({
      type: "session.created",
      properties: {
        info: session({ id: "ses_1", directory: "/repo", title: "Main" }),
      },
    } satisfies Event)
    store.dispatchEvent({
      type: "tui.session.select",
      properties: {
        sessionID: "ses_1",
      },
    } satisfies Event)
    store.dispatchEvent({
      type: "message.updated",
      properties: {
        info: userMessage({ id: "msg_1", sessionID: "ses_1" }),
      },
    } satisfies Event)
    store.dispatchEvent({
      type: "message.part.updated",
      properties: {
        part: part({ id: "part_1", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "hello" }),
      },
    } satisfies Event)
    store.dispatchEvent({
      type: "message.updated",
      properties: {
        info: assistantMessage({ id: "msg_2", sessionID: "ses_1", parentID: "msg_1" }),
      },
    } satisfies Event)
    store.dispatchEvent({
      type: "message.part.updated",
      properties: {
        part: part({ id: "part_2", sessionID: "ses_1", messageID: "msg_2", type: "text", text: "A" }),
      },
    } satisfies Event)
    store.dispatchEvent({
      type: "message.part.delta",
      properties: {
        sessionID: "ses_1",
        messageID: "msg_2",
        partID: "part_2",
        field: "text",
        delta: "BC",
      },
    } satisfies Event)
    store.dispatchEvent({
      type: "session.status",
      properties: {
        sessionID: "ses_1",
        status: { type: "busy", step: 1, maxSteps: 3 },
      },
    } satisfies Event)
    store.dispatchEvent({
      type: "permission.asked",
      properties: {
        id: "perm_1",
        sessionID: "ses_1",
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
      },
    } satisfies Event)
    store.dispatchEvent({
      type: "question.asked",
      properties: {
        id: "q_1",
        sessionID: "ses_1",
        questions: [
          {
            header: "Mode",
            question: "How should this run?",
            options: [
              { label: "Fast", description: "Return quickly" },
              { label: "Deep", description: "Inspect more" },
            ],
          },
        ],
      },
    } satisfies Event)
    store.dispatchEvent({
      type: "tui.prompt.append",
      properties: {
        text: "plan ",
      },
    } satisfies Event)
    store.dispatch({
      type: "prompt.changed",
      value: "plan next",
    })
    store.flush()

    const state = store.getSnapshot()
    expect(currentWorkspaceID(state)).toBe("/repo")
    expect(currentWorkspaceView(state)).toMatchObject({
      workspaceID: "/repo",
      directory: "/repo",
      worktree: "/repo",
    })
    expect(activeSessionID(state)).toBe("ses_1")
    expect(sessionsForWorkspace(state).map((item) => item.id)).toEqual(["ses_1"])
    expect(transcriptForSession(state)).toHaveLength(2)
    expect(transcriptForSession(state)[1]?.parts[0]).toMatchObject({ id: "part_2", text: "ABC" })
    expect(sessionStatusFor(state)).toEqual({ type: "busy", step: 1, maxSteps: 3 })
    expect(pendingPermission(state)?.id).toBe("perm_1")
    expect(pendingQuestion(state)?.id).toBe("q_1")
    expect(hasBlockingRequest(state)).toBe(true)
    expect(promptValue(state)).toBe("plan next")
  })

  test("tracks workspace selection independently from path hydration", () => {
    const store = createTuiStateStore({
      initial: {
        path: {
          home: "/home/test",
          state: "/state",
          config: "/config",
          worktree: "/repo",
          directory: "/repo/packages/app",
        },
        workspaceList: ["/repo", "/repo-two"],
        session: [session({ id: "ses_1", directory: "/repo" }), session({ id: "ses_2", directory: "/repo-two" })],
      },
    })

    store.dispatch({ type: "workspace.selected", workspaceID: "/repo-two" })

    const state = store.getSnapshot()
    expect(currentWorkspaceID(state)).toBe("/repo-two")
    expect(sessionsForWorkspace(state).map((item) => item.id)).toEqual(["ses_2"])
  })

  test("removes transcript state when a session is deleted", () => {
    const store = createTuiStateStore({
      initial: {
        session: [session({ id: "ses_1", directory: "/repo" })],
        message: {
          ses_1: [assistantMessage({ id: "msg_1", sessionID: "ses_1", parentID: "msg_0" })],
        },
        part: {
          msg_1: [part({ id: "part_1", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "hello" })],
        },
      },
    })

    store.dispatchEvent({
      type: "session.deleted",
      properties: {
        info: session({ id: "ses_1", directory: "/repo" }),
      },
    } satisfies Event)

    const state = store.getSnapshot()
    expect(state.session).toEqual([])
    expect(state.message.ses_1).toBeUndefined()
    expect(state.part.msg_1).toBeUndefined()
  })
})
