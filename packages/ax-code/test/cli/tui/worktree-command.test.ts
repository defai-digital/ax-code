import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { promptCommands, type PromptCommandsInput } from "../../../src/cli/tui/component/prompt/prompt-commands"
import {
  createWorktree,
  listWorktrees,
  matchWorktree,
  moveSessionToDirectory,
  removeWorktree,
} from "../../../src/cli/tui/component/dialog-worktree"
import type { DialogContext } from "../../../src/cli/tui/ui/dialog"

afterEach(() => vi.restoreAllMocks())

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function setup() {
  const composer = {
    focused: true,
    cursorOffset: 0,
    extmarks: { clear: vi.fn() },
    clear: vi.fn(),
    insertText: vi.fn(),
    setText: vi.fn(),
    gotoBufferEnd: vi.fn(),
  }
  let current: typeof composer | undefined
  let status = "idle"
  let session: string | undefined = "ses_worktree"
  const abort = vi.fn<PromptCommandsInput["sdk"]["client"]["session"]["abort"]>().mockResolvedValue({ data: true })
  const fetch = vi.fn<typeof globalThis.fetch>()
  const dialog = { clear: vi.fn(), stack: [], replace: vi.fn() } as unknown as DialogContext
  const host: PromptCommandsInput = {
    input: () => current!,
    store: { mode: "normal", prompt: { input: "draft", parts: [] } },
    setStore: vi.fn(),
    setExpandedPastes: vi.fn(),
    submit: vi.fn(),
    pasteClipboardImage: vi.fn(),
    autocompleteVisible: () => false,
    sessionID: () => session,
    statusType: () => status,
    sdk: { url: "http://127.0.0.1:4096", directory: "/tmp/opencode-test", fetch, client: { session: { abort } } },
    log: { warn: vi.fn() },
    toast: { show: vi.fn() },
    renderer: {},
    restoreExtmarksFromParts: vi.fn(),
    allPastesExpanded: () => false,
    pasteViewsLength: () => 0,
    setAllPastePreviews: vi.fn(),
    dialog,
    stash: { push: vi.fn(), pop: vi.fn(), list: () => [] },
  }
  return {
    host,
    dialog,
    fetch,
    mount: () => (current = composer),
    setStatus: (value: string) => (status = value),
    setSession: (value: string | undefined) => (session = value),
    command: () => promptCommands(host).find((option) => option.value === "session.worktree")!,
  }
}

describe("/worktree command registration", () => {
  test("exposes the command with a bare usage hint", async () => {
    const { command, host, dialog } = setup()

    const worktree = command()
    expect(worktree.slash).toMatchObject({ name: "worktree", arguments: true })

    await worktree.onSelect!(dialog)
    expect(host.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("/worktree new"), variant: "info" }),
    )
    expect(dialog.clear).toHaveBeenCalled()
  })

  test("falls back to the usage hint for an unknown subcommand", async () => {
    const { command, host, dialog, fetch } = setup()

    command().onSlashArguments!("bogus", dialog)
    await vi.waitFor(() => expect(host.toast.show).toHaveBeenCalled())
    await vi.waitFor(() => expect(dialog.clear).toHaveBeenCalled())

    expect(host.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "info" }))
    expect(fetch).not.toHaveBeenCalled()
  })

  test("refuses while a turn is running", async () => {
    const { command, host, dialog, fetch, setStatus } = setup()
    setStatus("busy")

    command().onSlashArguments!("list", dialog)
    await vi.waitFor(() => expect(host.toast.show).toHaveBeenCalled())

    expect(host.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }))
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe("/worktree new", () => {
  test("warns when no session is active", async () => {
    const { command, host, dialog, fetch, setSession } = setup()
    setSession(undefined)

    command().onSlashArguments!("new feature", dialog)
    await vi.waitFor(() => expect(host.toast.show).toHaveBeenCalled())

    expect(host.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }))
    expect(fetch).not.toHaveBeenCalled()
  })

  test("creates a worktree then moves the session into it", async () => {
    const { command, host, dialog, fetch } = setup()
    fetch
      .mockResolvedValueOnce(jsonResponse({ name: "feature", branch: "ax-code/feature", directory: "/tmp/wt/feature" }))
      .mockResolvedValueOnce(jsonResponse({ id: "ses_worktree", directory: "/tmp/wt/feature" }))

    command().onSlashArguments!("new feature", dialog)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(dialog.clear).toHaveBeenCalled())

    const [createUrl, createInit] = fetch.mock.calls[0] as [URL, RequestInit]
    expect(createUrl.pathname).toBe("/worktree")
    expect(createInit.method).toBe("POST")
    expect(JSON.parse(createInit.body as string)).toEqual({ name: "feature" })

    const [moveUrl, moveInit] = fetch.mock.calls[1] as [URL, RequestInit]
    expect(moveUrl.pathname).toBe("/session/ses_worktree/move")
    expect(moveInit.method).toBe("POST")
    expect(JSON.parse(moveInit.body as string)).toEqual({ targetDirectory: "/tmp/wt/feature" })

    expect(host.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }))
  })
})

describe("/worktree list", () => {
  test("opens the list dialog without clearing it", async () => {
    const { command, dialog } = setup()

    command().onSlashArguments!("list", dialog)
    await vi.waitFor(() => expect(dialog.replace).toHaveBeenCalledOnce())

    // The list view keeps the dialog open; clearing it here would dismiss it.
    expect(dialog.clear).not.toHaveBeenCalled()
  })
})

describe("/worktree remove", () => {
  test("hints usage when no target is given", async () => {
    const { command, host, dialog, fetch } = setup()

    command().onSlashArguments!("remove", dialog)
    await vi.waitFor(() => expect(host.toast.show).toHaveBeenCalled())

    expect(host.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "info" }))
    expect(fetch).not.toHaveBeenCalled()
  })

  test("warns when the target is not found", async () => {
    const { command, host, dialog, fetch } = setup()
    fetch.mockResolvedValueOnce(jsonResponse([{ name: "other", directory: "/tmp/wt/other" }]))

    command().onSlashArguments!("remove missing", dialog)
    await vi.waitFor(() => expect(host.toast.show).toHaveBeenCalled())

    expect(host.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test("removes the matched worktree by name", async () => {
    const { command, host, dialog, fetch } = setup()
    fetch
      .mockResolvedValueOnce(
        jsonResponse([{ name: "feature", directory: "/tmp/wt/feature", branch: "ax-code/feature" }]),
      )
      .mockResolvedValueOnce(jsonResponse(true))

    command().onSlashArguments!("remove feature", dialog)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(dialog.clear).toHaveBeenCalled())

    const [url, init] = fetch.mock.calls[1] as [URL, RequestInit]
    expect(url.pathname).toBe("/worktree")
    expect(init.method).toBe("DELETE")
    expect(JSON.parse(init.body as string)).toEqual({ directory: "/tmp/wt/feature" })
    expect(host.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }))
  })
})

describe("worktree request layer", () => {
  const sdk = {
    url: "http://127.0.0.1:4096",
    directory: "/tmp/opencode-test",
    fetch: vi.fn<typeof globalThis.fetch>(),
  }

  // A shared vi.fn keeps its call history across tests; reset it so each test
  // reads its own request from `sdk.fetch.mock.calls[0]`.
  beforeEach(() => sdk.fetch.mockReset())

  test("createWorktree posts the optional name", async () => {
    sdk.fetch.mockResolvedValueOnce(jsonResponse({ name: "n", branch: "ax-code/n", directory: "/tmp/wt/n" }))

    await expect(createWorktree({ sdk, name: "n" })).resolves.toEqual({
      name: "n",
      branch: "ax-code/n",
      directory: "/tmp/wt/n",
    })
    const [url, init] = sdk.fetch.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe("/worktree")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ name: "n" })
  })

  test("createWorktree sends an empty body when no name is given", async () => {
    sdk.fetch.mockResolvedValueOnce(jsonResponse({ name: "n", branch: "ax-code/n", directory: "/tmp/wt/n" }))

    await createWorktree({ sdk })
    const [, init] = sdk.fetch.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({})
  })

  test("listWorktrees parses the array payload", async () => {
    sdk.fetch.mockResolvedValueOnce(jsonResponse([{ name: "a", directory: "/tmp/wt/a" }]))

    await expect(listWorktrees({ sdk })).resolves.toEqual([{ name: "a", directory: "/tmp/wt/a" }])
    const [url, init] = sdk.fetch.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe("/worktree")
    expect(init.method).toBe("GET")
  })

  test("removeWorktree deletes by directory", async () => {
    sdk.fetch.mockResolvedValueOnce(jsonResponse(true))

    await removeWorktree({ sdk, directory: "/tmp/wt/a" })
    const [url, init] = sdk.fetch.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe("/worktree")
    expect(init.method).toBe("DELETE")
    expect(JSON.parse(init.body as string)).toEqual({ directory: "/tmp/wt/a" })
  })

  test("moveSessionToDirectory targets the session move route", async () => {
    sdk.fetch.mockResolvedValueOnce(jsonResponse({ id: "ses_x" }))

    await moveSessionToDirectory({ sdk, sessionID: "ses_x", directory: "/tmp/wt/a" })
    const [url, init] = sdk.fetch.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe("/session/ses_x/move")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ targetDirectory: "/tmp/wt/a" })
  })

  test("surfaces the server error message", async () => {
    sdk.fetch.mockResolvedValueOnce(
      jsonResponse({ name: "InvalidRequestError", message: "Worktrees are only supported for git projects" }, 400),
    )

    await expect(listWorktrees({ sdk })).rejects.toThrow("Worktrees are only supported for git projects")
  })

  test("matchWorktree resolves by name or directory", () => {
    const items = [{ name: "feature", directory: "/tmp/wt/feature" }]
    expect(matchWorktree(items, "feature")).toEqual(items[0])
    expect(matchWorktree(items, "/tmp/wt/feature")).toEqual(items[0])
    expect(matchWorktree(items, "other")).toBeUndefined()
  })
})
