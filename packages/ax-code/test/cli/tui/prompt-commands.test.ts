import { afterEach, describe, expect, test, vi } from "vitest"
import { promptCommands, type PromptCommandsInput } from "../../../src/cli/tui/component/prompt/prompt-commands"
import { askBtwSideQuestion, btwRequestFactory } from "../../../src/cli/tui/component/dialog-btw"
import type { DialogContext } from "../../../src/cli/tui/ui/dialog"

afterEach(() => vi.restoreAllMocks())

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
    sessionID: () => "ses_prompt_commands",
    statusType: () => "busy",
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
  return { composer, host, dialog, abort, fetch, mount: () => (current = composer) }
}

describe("prompt command lifecycle", () => {
  test("resolves the composer after command registration and before clearing a prompt", async () => {
    const { host, composer, dialog, mount } = setup()
    const commands = promptCommands(host)
    mount()

    await commands.find((command) => command.value === "prompt.clear")!.onSelect!(dialog)

    expect(composer.clear).toHaveBeenCalledOnce()
    expect(composer.extmarks.clear).toHaveBeenCalledOnce()
    expect(host.setStore).toHaveBeenCalledWith("prompt", { input: "", parts: [] })
  })

  test("resolves the mounted composer before submitting from a command", async () => {
    const { host, dialog, mount } = setup()
    const commands = promptCommands(host)
    mount()

    await commands.find((command) => command.value === "prompt.submit")!.onSelect!(dialog)

    expect(host.submit).toHaveBeenCalledOnce()
  })
})

describe("prompt session interrupt", () => {
  test.each([
    { error: { message: "Server refused interrupt" }, message: "Server refused interrupt" },
    { error: { data: { message: "Session is unavailable" } }, message: "Session is unavailable" },
    { error: "Connection failed", message: "Connection failed" },
    { error: { status: 503 }, message: "Failed to interrupt session" },
  ])("surfaces resolved SDK errors: $message", async ({ error, message }) => {
    const { host, dialog, mount, abort } = setup()
    mount()
    abort.mockResolvedValue({ error })
    const command = promptCommands(host).find((command) => command.value === "session.interrupt")!

    await command.onSelect!(dialog)
    await Promise.resolve()
    await Promise.resolve()

    expect(host.toast.show).toHaveBeenCalledWith({
      message,
      variant: "error",
    })
  })

  test("does not show an error for a successful interrupt", async () => {
    const { host, dialog, mount, abort } = setup()
    mount()
    const command = promptCommands(host).find((command) => command.value === "session.interrupt")!

    await command.onSelect!(dialog)
    await Promise.resolve()

    expect(abort).toHaveBeenCalledWith({ sessionID: "ses_prompt_commands" })
    expect(host.toast.show).not.toHaveBeenCalled()
  })
})

describe("/btw side question command", () => {
  test("registers as an argument-taking slash command and explains usage when bare", async () => {
    const { host, dialog, mount } = setup()
    mount()
    const command = promptCommands(host).find((command) => command.value === "session.btw")!

    expect(command.slash).toMatchObject({ name: "btw", arguments: true })
    expect(command.hidden).toBeFalsy()

    await command.onSelect!(dialog)
    expect(host.toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Usage: /btw <question> - answered without touching the session" }),
    )
    expect(dialog.clear).toHaveBeenCalled()
  })

  test("warns instead of asking when no session is active", async () => {
    const { host, dialog, mount } = setup()
    mount()
    host.sessionID = () => undefined
    const command = promptCommands(host).find((command) => command.value === "session.btw")!

    await command.onSlashArguments!("what happened?", dialog)

    expect(host.toast.show).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }))
    expect(dialog.replace).not.toHaveBeenCalled()
  })

  test("opens the dismissible dialog wired to the raw btw route", async () => {
    const { host, dialog, fetch, mount } = setup()
    mount()
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ answer: "The auth fix landed." }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const command = promptCommands(host).find((command) => command.value === "session.btw")!

    await command.onSlashArguments!("  status of the auth fix?  ", dialog)

    // The dialog is registered without executing its JSX (src tsx keeps
    // classic JSX under the vitest esbuild transform); the request wiring
    // is covered by btwRequestFactory below.
    expect(dialog.replace).toHaveBeenCalledOnce()
    const request = btwRequestFactory(
      { url: host.sdk.url, directory: host.sdk.directory, fetch: host.sdk.fetch },
      "ses_prompt_commands",
    )
    await expect(request("status of the auth fix?")).resolves.toEqual({ answer: "The auth fix landed." })
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit]
    expect(url.pathname).toBe("/session/ses_prompt_commands/btw")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ question: "status of the auth fix?" })
  })
})

describe("askBtwSideQuestion", () => {
  const sdk = { url: "http://127.0.0.1:4096", directory: "/tmp/opencode-test", fetch: vi.fn<typeof globalThis.fetch>() }

  test("surfaces the server error message for unavailable answers", async () => {
    sdk.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "InvalidRequestError",
          message: "There is no conversation history to answer from yet.",
          status: 400,
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    )
    await expect(askBtwSideQuestion({ sdk, sessionID: "ses_btw_tui", question: "status?" })).rejects.toThrow(
      "There is no conversation history to answer from yet.",
    )
  })

  test("rejects responses without a usable answer payload", async () => {
    sdk.fetch.mockResolvedValue(
      new Response(JSON.stringify({ text: "not the btw shape" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    await expect(askBtwSideQuestion({ sdk, sessionID: "ses_btw_tui", question: "status?" })).rejects.toThrow()
  })
})
