import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest"
import { createAgent, DisposedError } from "../../src/sdk/programmatic"
import { Server } from "../../src/server/server"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const auth = vi.hoisted(() => ({ password: "fixture password", username: undefined as string | undefined }))

vi.mock("../../src/flag/flag", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/flag/flag")>()
  return {
    ...actual,
    Flag: new Proxy(actual.Flag, {
      get(target, key, receiver) {
        if (key === "AX_CODE_SERVER_PASSWORD") return auth.password
        if (key === "AX_CODE_SERVER_USERNAME") return auth.username
        return Reflect.get(target, key, receiver)
      },
    }),
  }
})

beforeAll(() => {
  for (const name of ["AGENT", "AX_CODE", "OPENCODE", "AX_CODE_PID"]) vi.stubEnv(name, process.env[name])
})

afterAll(() => {
  vi.unstubAllEnvs()
})

afterEach(async () => {
  await Instance.disposeAll()
})

test.each([undefined, "embedding-user"])(
  "SDK session lifecycle honors Basic authentication for %s",
  async (username) => {
    auth.username = username
    await using tmp = await tmpdir()
    const app = Server.Default()
    // The same app still denies callers without the configured credentials.
    expect((await app.request("/global/health")).status).toBe(401)
    expect((await app.request("/global/health", { headers: { Authorization: "Basic invalid" } })).status).toBe(401)

    const agent = await createAgent({ directory: tmp.path })
    try {
      const session = await agent.session()
      expect(session.id).toMatch(/^ses_/)
      expect(await session.messages()).toEqual([])
    } finally {
      await agent.dispose()
    }
    await expect(agent.session()).rejects.toBeInstanceOf(DisposedError)
  },
)
