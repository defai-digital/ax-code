import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import path from "path"
import { pathToFileURL } from "url"
import stripAnsi from "strip-ansi"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { MessageID, PartID } from "../../src/session/schema"
import { Database } from "../../src/storage/db"
import { Process } from "../../src/util/process"
import { tmpdir } from "../fixture/fixture"

const ROOT = path.join(import.meta.dir, "../..")

function cmd(...args: string[]) {
  return [process.execPath, "run", path.join(ROOT, "src", "index.ts"), ...args]
}

async function fill(directory: string) {
  return Instance.provide({
    directory,
    fn: async () => {
      const session = await Session.create({ title: "CLI Context Session" })
      const user = MessageID.ascending()
      const aid = MessageID.ascending()

      await Session.updateMessage({
        id: user,
        sessionID: session.id,
        role: "user",
        time: { created: 1 },
        agent: "cli",
        model: { providerID: "test" as any, modelID: "test" as any },
        tools: {},
      } as any)
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: user,
        type: "text",
        text: "hello",
      })

      await Session.updateMessage({
        id: aid,
        sessionID: session.id,
        role: "assistant",
        parentID: user,
        providerID: "test" as any,
        modelID: "test-model" as any,
        mode: "chat",
        agent: "cli",
        path: { cwd: directory, root: directory },
        tokens: {
          input: 120,
          output: 34,
          reasoning: 5,
          cache: { read: 6, write: 0 },
        },
        time: { created: 2, completed: 3 },
      } as any)
      await Session.updatePart({
        id: PartID.ascending(),
        sessionID: session.id,
        messageID: aid,
        type: "text",
        text: "world",
      })

      return session
    },
  })
}

describe("cli smoke", () => {
  test("prints top-level help", async () => {
    const out = await Process.run(cmd("--help"), {
      cwd: ROOT,
    })

    const text = stripAnsi(out.stdout.toString())
    expect(out.code).toBe(0)
    expect(text).toContain("Commands:")
    expect(text).toContain("ax-code db")
    expect(text).toContain("--sandbox")
  }, 20000)

  test("returns non-zero for unknown top-level flags", async () => {
    const out = await Process.run(cmd("--definitely-unknown-flag"), {
      cwd: ROOT,
      nothrow: true,
    })

    const text = stripAnsi((out.stdout.toString() + out.stderr.toString()).trim())
    expect(out.code).toBe(1)
    expect(text).toContain("Commands:")
    expect(text).toContain("Options:")
  }, 20000)

  test("runs db path command through the real entrypoint", async () => {
    const out = await Process.run(cmd("db", "path"), {
      cwd: ROOT,
    })

    const text = out.stdout.toString().trim()
    expect(out.code).toBe(0)
    expect(text).toBe(path.join(Global.Path.data, "ax-code.db"))
  }, 20000)

  test("run --file resolves relative paths from AX_CODE_ORIGINAL_CWD", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "testfile.txt"), "hello")

    const out = await Process.run(cmd("run", "--file", "testfile.txt", "--", ""), {
      cwd: ROOT,
      env: {
        ...process.env,
        AX_CODE_ORIGINAL_CWD: tmp.path,
      },
      nothrow: true,
    })

    const text = stripAnsi(out.stdout.toString() + out.stderr.toString())
    expect(out.code).toBe(1)
    expect(text).not.toContain("File not found: testfile.txt")
    expect(text).toContain("You must provide a message or a command")
  }, 20000)

  test("isolates global data paths under AX_CODE_TEST_HOME in fresh processes", async () => {
    await using tmp = await tmpdir()
    const testHome = path.join(tmp.path, "home")
    const globalURL = pathToFileURL(path.join(ROOT, "src", "global", "index.ts")).href
    const env: NodeJS.ProcessEnv = { ...process.env, AX_CODE_TEST_HOME: testHome }
    delete env.XDG_DATA_HOME
    delete env.XDG_CACHE_HOME
    delete env.XDG_CONFIG_HOME
    delete env.XDG_STATE_HOME
    const code = `
      const { Global } = await import(${JSON.stringify(globalURL)})
      process.stdout.write(JSON.stringify({
        home: Global.Path.home,
        data: Global.Path.data,
        cache: Global.Path.cache,
        config: Global.Path.config,
        state: Global.Path.state,
        log: Global.Path.log,
        bin: Global.Path.bin
      }))
    `

    const out = await Process.run([process.execPath, "-e", code], {
      cwd: ROOT,
      env,
    })
    const paths = JSON.parse(out.stdout.toString()) as Record<string, string>

    expect(paths.home).toBe(testHome)
    expect(paths.data).toBe(path.join(testHome, ".local", "share", "ax-code"))
    expect(paths.cache).toBe(path.join(testHome, ".cache", "ax-code"))
    expect(paths.config).toBe(path.join(testHome, ".config", "ax-code"))
    expect(paths.state).toBe(path.join(testHome, ".local", "state", "ax-code"))
    expect(paths.log).toBe(path.join(paths.data, "log"))
    expect(paths.bin).toBe(path.join(paths.cache, "bin"))
  }, 20000)

  test("prints subcommand help", async () => {
    const out = await Process.run(cmd("db", "path", "--help"), {
      cwd: ROOT,
    })

    const text = stripAnsi(out.stdout.toString())
    expect(out.code).toBe(0)
    expect(text).toContain("ax-code db path")
    expect(text).toContain("print the database path")
  }, 20000)

  test("lists sessions in json through the real entrypoint", async () => {
    await using tmp = await tmpdir({ git: true })

    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "CLI Smoke Session" }),
    })

    const out = await Process.run(cmd("session", "list", "--format", "json"), {
      cwd: tmp.path,
    })

    const items = JSON.parse(out.stdout.toString()) as Array<{ id: string; title: string; directory: string }>
    expect(out.code).toBe(0)
    expect(items.some((item) => item.id === session.id && item.title === "CLI Smoke Session")).toBe(true)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("deletes a session through the real entrypoint", async () => {
    await using tmp = await tmpdir({ git: true })

    const session = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "CLI Delete Session" }),
    })

    const out = await Process.run(cmd("session", "delete", session.id), {
      cwd: tmp.path,
    })

    const text = stripAnsi(out.stdout.toString() + out.stderr.toString())
    expect(out.code).toBe(0)
    expect(text).toContain(`Session ${session.id} deleted`)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(Session.get(session.id)).rejects.toMatchObject({ name: "NotFoundError" })
      },
    })
  }, 20000)

  test("returns non-zero when deleting a missing session", async () => {
    await using tmp = await tmpdir({ git: true })

    const out = await Process.run(cmd("session", "delete", "session_missing"), {
      cwd: tmp.path,
      nothrow: true,
    })

    const text = stripAnsi((out.stdout.toString() + out.stderr.toString()).trim())
    expect(out.code).toBe(1)
    expect(text).toContain("Session not found: session_missing")
  }, 20000)

  test("skips malformed sessions in cli session list", async () => {
    await using tmp = await tmpdir({ git: true })

    const good = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "CLI Good Session" }),
    })
    const bad = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "CLI Bad Session" }),
    })

    Database.use((db) => {
      db.update(SessionTable)
        .set({ permission: { nope: true } as any })
        .where(eq(SessionTable.id, bad.id as any))
        .run()
    })

    const out = await Process.run(cmd("session", "list", "--format", "json"), {
      cwd: tmp.path,
    })

    const items = JSON.parse(out.stdout.toString()) as Array<{ id: string; title: string }>
    const ids = items.map((item) => item.id)

    expect(out.code).toBe(0)
    expect(ids).toContain(good.id)
    expect(ids).not.toContain(bad.id)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Session.remove(good.id)
      },
    })
  }, 20000)

  test("survives malformed sessions in cli stats", async () => {
    await using tmp = await tmpdir({ git: true })

    const good = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "CLI Stats Good Session" }),
    })
    const bad = await Instance.provide({
      directory: tmp.path,
      fn: async () => Session.create({ title: "CLI Stats Bad Session" }),
    })

    Database.use((db) => {
      db.update(SessionTable)
        .set({ permission: { nope: true } as any })
        .where(eq(SessionTable.id, bad.id as any))
        .run()
    })

    const out = await Process.run(cmd("stats"), {
      cwd: tmp.path,
    })

    const text = stripAnsi(out.stdout.toString())
    expect(out.code).toBe(0)
    expect(text).toContain("OVERVIEW")
    expect(text).toContain("Sessions")
    expect(text).toContain("1")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Session.remove(good.id)
      },
    })
  }, 20000)

  test("prints context stats through the real entrypoint", async () => {
    await using tmp = await tmpdir({ git: true })
    const session = await fill(tmp.path)

    const out = await Process.run(cmd("context", session.id), {
      cwd: tmp.path,
    })

    const text = stripAnsi(out.stdout.toString() + out.stderr.toString())
    expect(out.code).toBe(0)
    expect(text).toContain("Context Stats")
    expect(text).toContain(`Session: ${session.id}`)
    expect(text).toContain("Provider:   test")
    expect(text).toContain("Model:      test-model")
    expect(text).toContain("Messages:   2")
    expect(text).toContain("Input:      120")
    expect(text).toContain("Output:     34")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Session.remove(session.id)
      },
    })
  }, 20000)
})
