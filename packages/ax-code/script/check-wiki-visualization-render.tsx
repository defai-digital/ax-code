// Verify the actual context, attached runtime transport and fallback dialog.
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
const state = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-wiki-tui-"))
process.env.XDG_STATE_HOME = state
process.env.XDG_CONFIG_HOME = state
process.env.XDG_DATA_HOME = state
process.env.AX_CODE_DISABLE_PROJECT_CONFIG = "true"
const { testRender } = await import("ax-tui/solid")
const { KVProvider, useKV } = await import("../src/cli/tui/context/kv")
const { TuiConfigProvider } = await import("../src/cli/tui/context/tui-config")
const { SDKProvider, useSDK } = await import("../src/cli/tui/context/sdk")
const { LanguageProvider, useLanguage } = await import("../src/cli/tui/context/language")
const { ThemeProvider } = await import("../src/cli/tui/context/theme")
const { KeybindProvider } = await import("../src/cli/tui/context/keybind")
const { ToastProvider } = await import("../src/cli/tui/ui/toast")
const { DialogProvider, DialogStack } = await import("../src/cli/tui/ui/dialog")
const { WikiVisualizationProvider, useWikiVisualization } = await import("../src/cli/tui/context/wiki-visualization")
const { createWikiVisualizationManager } = await import("../src/cli/tui/util/wiki-visualization")
let wiki!: ReturnType<typeof useWikiVisualization>
let sdk!: ReturnType<typeof useSDK>
let ready = false
let requests = 0
let registrations = 0
let closed = 0
let load!: (response: Response) => void
let pending: Promise<Response> | undefined
const transport: typeof fetch = async (input, init) => {
  requests++
  const request = new Request(input, init)
  assert.equal(request.headers.get("authorization"), "Bearer fixture-secret")
  assert.equal(request.headers.get("x-opencode-directory"), "/remote/project")
  if (pending) return pending
  const url = new URL(request.url)
  if (url.pathname.endsWith("/enable") && ++registrations === 1) return Response.json({}, { status: 503 })
  if (url.pathname.endsWith("wiki-visualization")) return Response.json({ code: "missing" }, { status: 400 })
  return Response.json({ phase: "queued", reason: "idle", completed: 0, total: 0, revision: 0 })
}
const manager = createWikiVisualizationManager({
  serve: async () => ({
    url: "http://127.0.0.1:3210/fixture-capability",
    close: async () => {
      closed++
    },
  }),
  openBrowser: async () => {
    throw new Error("Fixture browser unavailable")
  },
})
function Probe() {
  wiki = useWikiVisualization()
  sdk = useSDK()
  useLanguage().setLocale("en")
  const kv = useKV()
  createEffect(() => {
    ready = kv.ready
  })
  return <text>{wiki.opening() ? "Opening fixture" : "Ready fixture"}</text>
}
const { createEffect } = await import("solid-js")
let setup: Awaited<ReturnType<typeof testRender>> | undefined
try {
  setup = await testRender(
    () => (
      <KVProvider>
        <TuiConfigProvider config={{}}>
          <SDKProvider
            url="http://127.0.0.1:4321"
            directory="/remote/project"
            fetch={transport}
            headers={{ authorization: "Bearer fixture-secret" }}
            events={{ on: () => () => {} }}
          >
            <LanguageProvider>
              <ToastProvider>
                <ThemeProvider mode="dark">
                  <KeybindProvider>
                    <DialogProvider>
                      <WikiVisualizationProvider manager={manager}>
                        <Probe />
                        <DialogStack />
                      </WikiVisualizationProvider>
                    </DialogProvider>
                  </KeybindProvider>
                </ThemeProvider>
              </ToastProvider>
            </LanguageProvider>
          </SDKProvider>
        </TuiConfigProvider>
      </KVProvider>
    ),
    { width: 80, height: 24 },
  )
  const deadline = Date.now() + 5000
  while (!ready && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    await setup.flush()
  }
  assert(ready)
  await wiki.enable("build")
  const registrationDeadline = Date.now() + 6000
  while (registrations < 2 && Date.now() < registrationDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await setup.flush()
  }
  assert.equal(registrations, 2, "Transient registration failure must retry")
  await wiki.open()
  await setup.flush()
  assert(setup.captureCharFrame().includes("Browser did not open: copy the link"))
  assert(setup.captureCharFrame().includes("http://127.0.0.1:3210/fixture-capability"))
  assert(setup.captureCharFrame().includes("Copy"))
  setup.mockInput.pressKey("ESCAPE")
  await new Promise((resolve) => setTimeout(resolve, 160))
  await setup.flush()
  pending = new Promise((resolve) => {
    load = resolve
  })
  const activation = wiki.open()
  await activation
  await setup.flush()
  assert(!wiki.opening())
  assert(setup.captureCharFrame().includes("fixture-capability"))
  setup.mockInput.pressKey("ESCAPE")
  await new Promise((resolve) => setTimeout(resolve, 160))
  await setup.flush()
  sdk.setWorkspace("/remote/other")
  load(Response.json({ phase: "ready", reason: "complete", completed: 1, total: 1, revision: 1 }))
  await activation
  await setup.flush()
  assert(!wiki.opening())
  assert(!setup.captureCharFrame().includes("fixture-capability"))
  assert(requests >= 2)
  console.log(
    "PASS: native immediate Wiki page, startup retry, missing/pending snapshots, authenticated runtime scope and workspace-change checks",
  )
} finally {
  await manager.dispose()
  assert.equal(closed, 1)
  setup?.renderer.destroy()
  await fs.rm(state, { recursive: true, force: true })
}
