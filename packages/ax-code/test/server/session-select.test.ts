import { describe, expect, test } from "vitest"
import path from "path"
import { Session } from "../../src/session"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"
import type { SessionID } from "../../src/session/schema"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("tui.selectSession endpoint", () => {
  test("should return 200 when called with valid session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const session = await Session.create({})

        // #when
        const app = Server.Default()
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: session.id }),
        })

        // #then
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toBe(true)

        await Session.remove(session.id)
      },
    })
  })

  test("should return 404 when session does not exist", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const nonExistentSessionID = "ses_nonexistent123"

        // #when
        const app = Server.Default()
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: nonExistentSessionID }),
        })

        // #then
        expect(response.status).toBe(404)
      },
    })
  })

  test("should return 409 when session belongs to another project", async () => {
    await using other = await tmpdir({ git: true })
    let otherSessionID: SessionID | undefined

    await Instance.provide({
      directory: other.path,
      fn: async () => {
        const session = await Session.create({})
        otherSessionID = session.id
      },
    })

    try {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const app = Server.Default()
          const response = await app.request("/tui/select-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionID: otherSessionID }),
          })

          expect(response.status).toBe(409)
        },
      })
    } finally {
      if (otherSessionID) {
        const sessionID = otherSessionID
        await Instance.provide({
          directory: other.path,
          fn: async () => {
            await Session.remove(sessionID)
          },
        }).catch(() => undefined)
      }
    }
  })

  test("should return 400 when session ID format is invalid", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // #given
        const invalidSessionID = "invalid_session_id"

        // #when
        const app = Server.Default()
        const response = await app.request("/tui/select-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionID: invalidSessionID }),
        })

        // #then
        expect(response.status).toBe(400)
      },
    })
  })
})
