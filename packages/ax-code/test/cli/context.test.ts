import { afterEach, describe, expect, test, vi } from "vitest"
import { ContextCommand } from "../../src/cli/cmd/context"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, type SessionID } from "../../src/session/schema"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

async function withCwd<T>(cwd: string, fn: () => T | Promise<T>) {
  const previous = process.cwd()
  process.chdir(cwd)
  try {
    return await fn()
  } finally {
    process.chdir(previous)
  }
}

function captureOutput() {
  let output = ""
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    output += String(chunk)
    return true
  }) as never)
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    output += String(chunk)
    return true
  }) as never)
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    output += args.map(String).join(" ") + "\n"
  })
  return {
    output: () => output,
    restore() {
      stdout.mockRestore()
      stderr.mockRestore()
      log.mockRestore()
    },
  }
}

async function addAssistantExchange(sessionID: SessionID, directory: string) {
  const user = await Session.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "test-provider", modelID: "test-model" },
    tools: {},
    mode: "build",
  } as unknown as MessageV2.User)
  await Session.updateMessage({
    id: MessageID.ascending(),
    parentID: user.id,
    sessionID,
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    tokens: {
      input: 10,
      output: 5,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: "test-model",
    providerID: "test-provider",
    time: { created: Date.now() },
  } as MessageV2.Assistant)
}

describe("context command session selection (#402)", () => {
  test("skips ghost sessions without assistant model context", async () => {
    await using project = await tmpdir({ git: true })
    const valid = await Instance.provide({
      directory: project.path,
      fn: async () => {
        const session = await Session.create({ title: "valid" })
        await addAssistantExchange(session.id, project.path)
        return session
      },
    })
    // Ensure the empty session sorts as the most recently updated.
    await new Promise((resolve) => setTimeout(resolve, 10))
    const ghost = await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "ghost" }),
    })

    const captured = captureOutput()
    try {
      await withCwd(project.path, () =>
        ContextCommand.handler({
          sessionID: undefined,
          $0: "ax-code",
          _: ["context"],
        } as never),
      )
    } finally {
      captured.restore()
    }

    expect(captured.output()).toContain(valid.id)
    expect(captured.output()).not.toContain(ghost.id)
  })

  test("finds a session by id even when it is outside the recent-sessions window", async () => {
    await using project = await tmpdir({ git: true })
    const [older, newer] = await Instance.provide({
      directory: project.path,
      fn: async () => {
        const first = await Session.create({ title: "older" })
        await addAssistantExchange(first.id, project.path)
        const second = await Session.create({ title: "newer" })
        return [first, second]
      },
    })
    // Stand in for a project with more sessions than the listing returns.
    const list = vi.spyOn(Session, "list").mockImplementation(function* () {
      yield newer
    })

    const captured = captureOutput()
    try {
      await withCwd(project.path, () =>
        ContextCommand.handler({ sessionID: older.id, $0: "ax-code", _: ["context"] } as never),
      )
    } finally {
      captured.restore()
      list.mockRestore()
    }

    expect(captured.output()).not.toContain("not found")
    expect(captured.output()).toContain("Title: older")
  })

  test("conversation history is the latest turn's context, not a sum over turns", async () => {
    await using project = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: project.path,
      fn: async () => {
        const created = await Session.create({ title: "three turns" })
        // Each turn reports input 10 + output 5; a sum would show 30 input.
        for (let i = 0; i < 3; i++) await addAssistantExchange(created.id, project.path)
        return created
      },
    })

    const captured = captureOutput()
    try {
      await withCwd(project.path, () =>
        ContextCommand.handler({ sessionID: session.id, $0: "ax-code", _: ["context"] } as never),
      )
    } finally {
      captured.restore()
    }

    expect(captured.output()).toMatch(/Conversation history\s+15\b/)
  })

  test("reports when no session has model context", async () => {
    await using project = await tmpdir({ git: true })
    await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "ghost" }),
    })

    const captured = captureOutput()
    try {
      await withCwd(project.path, () =>
        ContextCommand.handler({
          sessionID: undefined,
          $0: "ax-code",
          _: ["context"],
        } as never),
      )
    } finally {
      captured.restore()
    }

    expect(captured.output()).toContain("No session with model context found")
  })
})
