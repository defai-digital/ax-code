import { expect, test, vi } from "vitest"
import { autoAcceptCommand, requestAutoAccept } from "../../../src/cli/tui/component/prompt/auto-accept"
import type { DialogContext } from "../../../src/cli/tui/ui/dialog"
import { hasHookRewrite } from "../../../src/cli/tui/routes/session/tool-rendering"

test("auto-accept command has a slash entry and configurable keybind", async () => {
  const toggle = vi.fn(async () => {})
  const clear = vi.fn()
  const command = autoAcceptCommand("Toggle project auto-accept", toggle)
  expect(command.slash?.name).toBe("auto-accept")
  expect(command.keybind).toBe("project_auto_accept")
  command.onSelect?.({ clear } as unknown as DialogContext)
  expect(clear).toHaveBeenCalledOnce()
  expect(toggle).toHaveBeenCalledOnce()
})

test("TUI toggle uses the connected fetch and directory without writing config", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return Response.json({ enabled: init?.method === "PUT", managedDisabled: false, directory: "/project" })
  })
  const sdk = { url: "http://localhost:4096", directory: "/project", fetch: fetcher }
  expect((await requestAutoAccept(sdk)).enabled).toBe(false)
  expect((await requestAutoAccept(sdk, true)).enabled).toBe(true)
  expect(calls.map((call) => call.url)).toEqual([
    "http://localhost:4096/permission/auto-accept",
    "http://localhost:4096/permission/auto-accept",
  ])
  expect(calls[1].init?.body).toBe('{"enabled":true}')
  expect(new Headers(calls[1].init?.headers).get("x-ax-code-directory")).toBe("/project")
})

test("malformed status and backend refusal cannot report an enabled toggle", async () => {
  const sdk = {
    url: "http://localhost:4096",
    directory: "/project",
    fetch: vi.fn(async () => Response.json({ enabled: "true" })),
  }
  await expect(requestAutoAccept(sdk)).rejects.toThrow()
  sdk.fetch.mockImplementation(async () =>
    Response.json({ message: "Runtime authorization required" }, { status: 403 }),
  )
  await expect(requestAutoAccept(sdk, true)).rejects.toThrow()
})

test("tool rewrite visibility uses structured audit metadata", () => {
  expect(hasHookRewrite({ hookRewrite: { hooks: ["node"], before: "{}", after: "{}" } })).toBe(true)
  for (const value of [undefined, {}, { hookRewrite: "untrusted" }, { hookRewrite: { hooks: "node" } }]) {
    expect(hasHookRewrite(value)).toBe(false)
  }
})
