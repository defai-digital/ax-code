import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const {
  reloadLocalRendererWindowsAfterServerRestart,
  resolveServerRestartReloadUrl,
} = require("./server-window-reload.js")

const mockWindow = (url, { destroyed = false, fail = false } = {}) => {
  const loadedUrls = []
  return {
    loadedUrls,
    isDestroyed: () => destroyed,
    webContents: {
      getURL: () => url,
    },
    loadURL: async (nextUrl) => {
      loadedUrls.push(nextUrl)
      if (fail) throw new Error("load failed")
    },
  }
}

describe("resolveServerRestartReloadUrl", () => {
  test("rewrites local renderer URLs from the old server port to the new port", () => {
    expect(
      resolveServerRestartReloadUrl("http://localhost:3910/mini-chat.html?mode=session&sessionId=s1", {
        oldPort: 3910,
        newPort: 3920,
      }),
    ).toBe("http://localhost:3920/mini-chat.html?mode=session&sessionId=s1")
    expect(
      resolveServerRestartReloadUrl("http://127.0.0.1:3910/projects?tab=chat#bottom", {
        oldPort: 3910,
        newPort: 3920,
      }),
    ).toBe("http://127.0.0.1:3920/projects?tab=chat#bottom")
    expect(
      resolveServerRestartReloadUrl("http://127.0.0.2:3910/projects?tab=chat#bottom", {
        oldPort: 3910,
        newPort: 3920,
      }),
    ).toBe("http://127.0.0.2:3920/projects?tab=chat#bottom")
  })

  test("does not rewrite remote hosts or unrelated localhost ports", () => {
    expect(
      resolveServerRestartReloadUrl("https://remote.example.com/app", {
        oldPort: 3910,
        newPort: 3920,
      }),
    ).toBeNull()
    expect(
      resolveServerRestartReloadUrl("http://localhost:5173/", {
        oldPort: 3910,
        newPort: 3920,
      }),
    ).toBeNull()
  })

  test("ignores malformed urls and invalid ports", () => {
    expect(resolveServerRestartReloadUrl("not a url", { oldPort: 3910, newPort: 3920 })).toBeNull()
    expect(resolveServerRestartReloadUrl("http://localhost:3910/", { oldPort: 0, newPort: 3920 })).toBeNull()
    expect(resolveServerRestartReloadUrl("http://localhost:3910/", { oldPort: 3910, newPort: 0 })).toBeNull()
  })
})

describe("reloadLocalRendererWindowsAfterServerRestart", () => {
  test("reloads every live local renderer window and preserves each path", async () => {
    const main = mockWindow("http://localhost:3910/")
    const miniChat = mockWindow("http://localhost:3910/mini-chat.html?mode=draft")
    const loopbackAlias = mockWindow("http://127.0.0.2:3910/session/alias")
    const remote = mockWindow("https://remote.example.com/app")
    const destroyed = mockWindow("http://localhost:3910/session/old", { destroyed: true })

    const result = await reloadLocalRendererWindowsAfterServerRestart([main, miniChat, loopbackAlias, remote, destroyed], {
      oldPort: 3910,
      newPort: 3920,
    })

    expect(result).toEqual({
      attempted: 3,
      failed: 0,
      urls: [
        "http://localhost:3920/",
        "http://localhost:3920/mini-chat.html?mode=draft",
        "http://127.0.0.2:3920/session/alias",
      ],
    })
    expect(main.loadedUrls).toEqual(["http://localhost:3920/"])
    expect(miniChat.loadedUrls).toEqual(["http://localhost:3920/mini-chat.html?mode=draft"])
    expect(loopbackAlias.loadedUrls).toEqual(["http://127.0.0.2:3920/session/alias"])
    expect(remote.loadedUrls).toEqual([])
    expect(destroyed.loadedUrls).toEqual([])
  })

  test("reports failed reload attempts without aborting remaining windows", async () => {
    const failed = mockWindow("http://localhost:3910/", { fail: true })
    const second = mockWindow("http://localhost:3910/mini-chat.html")

    const result = await reloadLocalRendererWindowsAfterServerRestart([failed, second], {
      oldPort: 3910,
      newPort: 3920,
    })

    expect(result).toEqual({
      attempted: 2,
      failed: 1,
      urls: ["http://localhost:3920/", "http://localhost:3920/mini-chat.html"],
    })
    expect(second.loadedUrls).toEqual(["http://localhost:3920/mini-chat.html"])
  })
})
