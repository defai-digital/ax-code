import { expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { createServer } from "node:http"
import { once } from "node:events"
import { createRequire } from "node:module"
import { MockLanguageModelV3 } from "ai/test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Provider } from "../../src/provider/provider"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { resolveTools } from "../../src/session/prompt/prompt-tools"
import { BrowserWorkflowStore } from "../../src/browser-workflow/store"
import { Process } from "../../src/util/process"
import { parseJsonStrict } from "../../src/util/json-value"
import type { SessionID } from "../../src/session/schema"

const chrome = process.env.AX_TEST_WEBMCP_CHROME
test.skipIf(!chrome)(
  "native authoring, inventory, diagnosis, recipes, lifecycle regression and model-selection dispatch",
  { timeout: 180000, retry: 0 },
  async () => {
    const entry = {
      ...WebMcpProfile.config(
        { allowedOrigins: [], read: true, interact: true, headless: true, executablePath: chrome },
        true,
      ),
      timeout: 20000,
    }
    await using tmp = await tmpdir({ git: true, config: { mcp: { live: entry } } })
    const html = `<!doctype html><title>Workbench fixture</title><button id="remove">Remove lookup</button><div role="status" aria-label="Ready">Ready</div><script type="module" src="/registration.js"></script>`
    const app = "export async function lookup({q}) { if (!q) throw new Error('Missing query'); return {q, count:2} }\n"
    await fs.writeFile(path.join(tmp.path, "app.js"), app)
    let formPage = html
    const serve = async (url: string) =>
      ["/app.js", "/registration.js", "/form.js"].includes(url)
        ? fs.readFile(path.join(tmp.path, url.slice(1)), "utf8")
        : url === "/form"
          ? formPage
          : html
    await using server = createServer((request, response) => {
      response.setHeader("Content-Type", request.url?.endsWith(".js") ? "text/javascript" : "text/html")
      void serve(request.url ?? "/").then(
        (body) => response.end(body),
        () => {
          response.statusCode = 500
          response.end("Fixture unavailable")
        },
      )
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Fixture port unavailable")
    const origin = `http://127.0.0.1:${address.port}`
    const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: '{"name":"lookup","arguments":{"q":"AX"}}' }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 10, text: 10, reasoning: undefined },
        },
        warnings: [],
      }),
    })
    const language = vi.spyOn(Provider, "getLanguage").mockResolvedValue(model)
    const sessionID = "ses_workbench_live" as SessionID
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await MCP.connect("live")
          expect((await MCP.status()).live).toMatchObject({ status: "connected" })
          const input = {
            agent: { name: "build", permission: [{ permission: "*", pattern: "*", action: "allow" }] },
            session: { id: sessionID, permission: [] },
            model: {
              id: "fixture-model",
              providerID: "test",
              api: { id: "fixture-model", npm: "@ai-sdk/openai-compatible" },
              limit: { output: 2048 },
            },
            tools: {},
            bypassAgentCheck: false,
            messages: [],
            processor: { message: { id: "msg_workbench_live" }, partFromToolCall: () => undefined },
          }
          const tools = await resolveTools(input as never)
          let sequence = 0
          const options = () => ({
            toolCallId: `workbench_${++sequence}`,
            messages: [],
            abortSignal: new AbortController().signal,
          })
          const call = async (args: unknown): Promise<Record<string, any>> => {
            const result = (await tools.browser_workflow.execute!(args, options())) as { output: string }
            return parseJsonStrict(result.output) as Record<string, any>
          }
          const generated = await call({
            action: "author",
            name: "lookup",
            description: "Read fixture item count by query",
            module: "./app.js",
            exportName: "lookup",
            schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
            format: "imperative",
            effect: "read",
          })
          await fs.writeFile(
            path.join(tmp.path, "registration.js"),
            generated.javascript +
              `\nconst lifecycle = new AbortController(); await registerWebMcpTool(lifecycle.signal);
document.querySelector('#remove').onclick = () => { lifecycle.abort(); const status = document.querySelector('[role=status]'); status.textContent = 'Removed'; status.setAttribute('aria-label','Removed'); console.error('Fixture removal at app.js:1'); };
`,
          )
          await tools.live_new_page.execute!({ url: origin }, options())
          const raw = await MCP.tools()
          const pages = WebMcpProfile.parseStructuredPages(await raw.live_list_pages.execute!({}, options()))!
          const pageId = [...pages].find(([, url]) => new URL(url).origin === origin)![0]
          const target = { server: "live", pageId, origin }
          const inventory = await call({ action: "inventory", ...target, sourceFiles: ["registration.js", "app.js"] })
          expect(inventory.tools).toHaveLength(1)
          expect(inventory.sources.mappings[0].confidence).toBe("name_and_schema_candidate")
          const status = await call({ action: "status", ...target })
          expect(status.route).toBe("native-tools-available")
          const evaluated = await call({
            action: "selection_eval",
            inventoryId: inventory.inventoryId,
            cases: [{ task: "Find AX", expected: { name: "lookup", arguments: { q: "AX" } } }],
          })
          expect(evaluated).toMatchObject({ model: "test/fixture-model", jointlyCorrect: 1, executesTools: false })
          expect(model.doGenerateCalls[0]!.tools ?? []).toHaveLength(0)
          expect(JSON.stringify(model.doGenerateCalls[0]!.prompt)).not.toContain('"expected"')
          const ready = { locator: { role: "status", name: "Ready" }, property: "count", equals: 1 }
          const observed = await call({ action: "observe", ...target, assertions: [ready], sourceFiles: ["app.js"] })
          const recipe = await call({
            action: "recipe",
            server: "live",
            pageId,
            definition: {
              version: 1,
              name: "Native lookup check",
              origin,
              assertions: [ready],
              queries: [
                {
                  name: "lookup",
                  descriptorHash: inventory.tools[0].descriptorHash,
                  input: { q: "AX" },
                  resultPath: ["count"],
                  equals: 2,
                },
              ],
            },
          })
          expect(recipe.status).toBe("pass")
          expect(
            ask.mock.calls.some(
              ([request]) => request.permission === "webmcp" && request.metadata.tool === "execute_webmcp_tool",
            ),
          ).toBe(true)
          // A plain approved click changes the application; diagnosis never performs it implicitly.
          await tools.live_take_snapshot.execute!({ pageId }, options())
          const liveProfile = raw.live_click.webmcp!.profile
          const snapshot = await raw.live_take_snapshot.execute!({ pageId }, options())
          const nodes = WebMcpProfile.parseStructuredSnapshot(snapshot)!
          const button = [...nodes.values()].find((node) => node.role === "button" && node.name === "Remove lookup")!
          expect(button).toBeDefined()
          await tools.live_click.execute!({ pageId, uid: button.uid }, options())
          const diagnosis = await call({ action: "diagnose", observationId: observed.observationId })
          expect(diagnosis.status).toBe("fail")
          expect(diagnosis.inventoryChanges).toEqual([{ name: "lookup", kind: "removed", fields: [] }])
          expect(diagnosis.sourceCandidates[0].file).toBe("app.js")
          const diff = await call({ action: "inventory", ...target, baselineId: inventory.inventoryId })
          expect(diff.changes).toEqual([{ name: "lookup", kind: "removed", fields: [] }])
          const check = await call({
            action: "recipe",
            server: "live",
            pageId,
            definition: { version: 1, name: "Preview state", origin, assertions: [ready] },
          })
          expect(check).toMatchObject({ status: "fail", route: "snapshot-only" })
          await fs.writeFile(
            path.join(tmp.path, "server.mjs"),
            `import {createServer} from 'node:http'; import {readFile} from 'node:fs/promises';
createServer(async(q,r)=>{r.setHeader('Content-Type',q.url.endsWith('.js')?'text/javascript':'text/html');r.end(q.url==='/app.js'||q.url==='/registration.js'?await readFile('.'+q.url,'utf8'):${JSON.stringify(html)});}).listen(Number(process.argv[2]),'127.0.0.1');`,
          )
          const frozen = await call({
            action: "promote",
            observationId: diagnosis.observationId,
            manifest: {
              version: 1,
              name: "Tool unregister on route exit",
              server: "node server.mjs {port}",
              steps: [
                {
                  action: "tool_presence",
                  name: "lookup",
                  present: true,
                  descriptorHash: inventory.tools[0].descriptorHash,
                },
                { action: "click", locator: { role: "button", name: "Remove lookup" } },
                { action: "tool_presence", name: "lookup", present: false },
              ],
            },
          })
          expect(BrowserWorkflowStore.receipts(sessionID, frozen.hash)).toHaveLength(0)
          const ran = await call({ action: "run", hash: frozen.hash, server: "live" })
          expect(ran.receipt.status, JSON.stringify(ran)).toBe("pass")
          const exportedResult = (await tools.browser_workflow.execute!(
            { action: "export", hash: frozen.hash },
            options(),
          )) as { output: string }
          await fs.writeFile(path.join(tmp.path, "regression.mjs"), exportedResult.output)
          await fs.mkdir(path.join(tmp.path, "node_modules"), { recursive: true })
          await fs.symlink(
            path.dirname(createRequire(import.meta.url).resolve("playwright-core/package.json")),
            path.join(tmp.path, "node_modules/playwright-core"),
            "dir",
          )
          const exported = await Process.run([process.execPath, "regression.mjs"], {
            cwd: tmp.path,
            env: { ...process.env, AX_TEST_WEBMCP_CHROME: chrome! },
            timeout: 30000,
            nothrow: true,
          })
          expect(exported.code, exported.stderr.toString()).toBe(0)
          const declarative = await call({
            action: "author",
            name: "find_items",
            description: "Find fixture items by query",
            module: "./app.js",
            exportName: "lookup",
            format: "declarative",
            effect: "read",
            schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
          })
          formPage = `<!doctype html><title>Declarative fixture</title>${declarative.html}<script type="module" src="/form.js"></script>`
          await fs.writeFile(
            path.join(tmp.path, "form.js"),
            declarative.javascript +
              `\nbindWebMcpForm(new AbortController().signal);
// Fixture-only simulated human confirmation after agent prefill; production templates never auto-submit.
let confirmationPending = false;
const confirm = () => { if (confirmationPending) return; confirmationPending = true; setTimeout(() => document.querySelector('form').requestSubmit(), 20); };
// Chrome 155 uses Window; the current draft dispatches on ModelContext.
window.addEventListener('toolactivated', confirm);
document.modelContext.addEventListener('toolactivated', confirm);
`,
          )
          await tools.live_new_page.execute!({ url: origin + "/form" }, options())
          const formPages = WebMcpProfile.parseStructuredPages(await raw.live_list_pages.execute!({}, options()))!
          const formPageId = [...formPages].find(([, url]) => url === origin + "/form")![0]
          const formInventory = await call({ action: "inventory", server: "live", pageId: formPageId, origin })
          expect(formInventory.tools[0].name).toBe("find_items")
          const formResult = await call({
            action: "recipe",
            server: "live",
            pageId: formPageId,
            definition: {
              version: 1,
              name: "Confirmed declarative search",
              origin,
              queries: [
                {
                  name: "find_items",
                  descriptorHash: formInventory.tools[0].descriptorHash,
                  input: { q: "AX" },
                  resultPath: ["count"],
                  equals: 2,
                },
              ],
            },
          })
          expect(formResult.status, JSON.stringify(formResult)).toBe("pass")
          // Reconnect cannot make old observation IDs valid again, even if page IDs are reused.
          await MCP.disconnect("live")
          await MCP.connect("live")
          expect(await MCP.matchesWebMcpProfile("live", liveProfile)).toBe(false)
          await expect(call({ action: "diagnose", observationId: observed.observationId })).rejects.toThrow()
        },
      })
    } finally {
      ask.mockRestore()
      language.mockRestore()
      await Instance.disposeAll()
    }
  },
)
