import { expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { once } from "node:events"
import { createRequire } from "node:module"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { resolveTools } from "../../src/session/prompt/prompt-tools"
import { BrowserWorkflowStore } from "../../src/browser-workflow/store"
import { Process } from "../../src/util/process"
import { parseJsonStrict } from "../../src/util/json-value"
import { git } from "../../src/util/git"
import type { SessionID } from "../../src/session/schema"

const chrome = process.env.AX_TEST_WEBMCP_CHROME
const serverSource = (broken: boolean) => `import { createServer } from 'node:http';
const html = ${JSON.stringify(`<!doctype html><title>Search fixture</title><label>Search<input id="query"></label><button id="clear">Clear</button><div role="status" aria-label="All results" id="result">All results</div><div role="status" aria-label="Fresh context" id="clean">Fresh context</div><script>
if (document.cookie.includes("fixture_seen")) document.querySelector("#clean").setAttribute("aria-label", "Dirty context");
document.cookie = "fixture_seen=yes; path=/";
const update = () => { setTimeout(() => { const q = document.querySelector('#query').value; const result = document.querySelector('#result'); const text = ${broken ? "'Broken'" : "q === 'AX' ? 'Found AX' : q ? 'No results' : 'All results'"}; result.textContent = text; result.setAttribute('aria-label', text); }, 300); };
document.querySelector('#query').addEventListener('input', update);
document.querySelector('#clear').onclick = () => { document.querySelector('#query').value = ''; update(); };
</script>`)};
createServer((req,res) => { res.setHeader('Content-Type','text/html'); res.end(html); }).listen(Number(process.argv[2]), '127.0.0.1');
`

test.skipIf(!chrome)(
  "frozen search fails before fix, passes twice through the real wrapper, and exported regression passes twice",
  { timeout: 180_000, retry: 0 },
  async () => {
    const entry = {
      ...WebMcpProfile.config(
        { allowedOrigins: [], read: true, interact: true, headless: true, executablePath: chrome },
        true,
      ),
      timeout: 15000,
    }
    await using tmp = await tmpdir({ git: true, config: { mcp: { live: entry } } })
    const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
    try {
      await fs.writeFile(path.join(tmp.path, ".gitignore"), "node_modules/\nregression.mjs\n")
      await fs.writeFile(path.join(tmp.path, "server.mjs"), serverSource(true))
      await git(["add", "server.mjs", ".gitignore"], { cwd: tmp.path })
      await git(["commit", "-m", "Add broken search fixture"], { cwd: tmp.path })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await MCP.connect("live")
          const sessionID = "ses_browser_live" as SessionID
          const input = {
            agent: { name: "build", permission: [{ permission: "*", pattern: "*", action: "allow" }] },
            session: { id: sessionID, permission: [] },
            model: { providerID: "test", api: { id: "test", npm: "@ai-sdk/openai-compatible" } },
            tools: {},
            bypassAgentCheck: false,
            messages: [],
            processor: { message: { id: "msg_browser_live" }, partFromToolCall: () => undefined },
          }
          const tools = await resolveTools(input as never)
          let sequence = 0
          const call = async (args: unknown) =>
            (await tools.browser_workflow.execute!(args, {
              toolCallId: `call_workflow_${++sequence}`,
              messages: [],
              abortSignal: new AbortController().signal,
            })) as { output: string; metadata: Record<string, unknown> }
          const assertStatus = (name: string) => ({
            action: "assert",
            timeoutMs: 2000,
            assertion: { locator: { role: "status", name }, property: "count", equals: 1 },
          })
          const frozen = await call({
            action: "freeze",
            manifest: {
              version: 1,
              name: "Search clear and no results",
              server: "node server.mjs {port}",
              steps: [
                assertStatus("Fresh context"),
                { action: "fill", locator: { role: "textbox", name: "Search" }, value: "AX" },
                {
                  action: "assert",
                  timeoutMs: 2000,
                  assertion: { locator: { role: "textbox", name: "Search" }, property: "value", equals: "AX" },
                },
                assertStatus("Found AX"),
                { action: "click", locator: { role: "button", name: "Clear" } },
                assertStatus("All results"),
                { action: "fill", locator: { role: "textbox", name: "Search" }, value: "missing" },
                assertStatus("No results"),
              ],
            },
          })
          const hash = frozen.metadata.scenarioHash as string
          const control = await call({ action: "run", hash, server: "live" })
          expect(control.metadata.status, control.output).toBe("fail")
          expect(BrowserWorkflowStore.control(sessionID, hash, await BrowserWorkflowStore.identity()).hash).toBe(hash)
          await fs.writeFile(path.join(tmp.path, "server.mjs"), serverSource(false))
          for (let n = 0; n < 2; n++) {
            const fixed = await call({ action: "run", hash, server: "live" })
            expect(fixed.metadata.status, fixed.output).toBe("pass")
          }
          const receipts = BrowserWorkflowStore.receipts(sessionID, hash)
          expect(new Set(receipts.map((receipt) => receipt.origin)).size).toBe(3)
          expect(
            BrowserWorkflowStore.qualifies(
              receipts,
              BrowserWorkflowStore.get(sessionID, hash),
              await BrowserWorkflowStore.identity(),
            ),
          ).toBe(true)
          expect(
            ask.mock.calls.some(([request]) => request.permission === "webmcp" && request.metadata.tool === "fill"),
          ).toBe(true)
          const exported = await call({ action: "export", hash })
          const output = path.join(tmp.path, "regression.mjs")
          await fs.writeFile(output, exported.output)
          const require = createRequire(import.meta.url)
          await fs.mkdir(path.join(tmp.path, "node_modules"), { recursive: true })
          await fs.symlink(
            path.dirname(require.resolve("playwright-core/package.json")),
            path.join(tmp.path, "node_modules/playwright-core"),
            "dir",
          )
          for (let n = 0; n < 2; n++) {
            const ran = await Process.run([process.execPath, output], {
              cwd: tmp.path,
              env: { ...process.env, AX_TEST_WEBMCP_CHROME: chrome! },
              timeout: 30000,
              nothrow: true,
            })
            expect(ran.code, ran.stderr.toString()).toBe(0)
            expect(parseJsonStrict(ran.stdout.toString())).toMatchObject({ status: "pass", scenarioHash: hash })
          }
          // An exported test must also detect the intentionally broken control.
          await fs.writeFile(path.join(tmp.path, "server.mjs"), serverSource(true))
          const brokenExport = await Process.run([process.execPath, output], {
            cwd: tmp.path,
            env: { ...process.env, AX_TEST_WEBMCP_CHROME: chrome! },
            timeout: 30000,
            nothrow: true,
          })
          expect(brokenExport.code).not.toBe(0)
          const deniedTools = await resolveTools({ ...input, tools: { live_fill: false } } as never)
          const denied = (await deniedTools.browser_workflow.execute!(
            { action: "run", hash, server: "live" },
            { toolCallId: "denied", messages: [], abortSignal: new AbortController().signal },
          )) as { metadata: Record<string, unknown> }
          expect(denied.metadata.status).toBe("unknown")
        },
      })
    } finally {
      ask.mockRestore()
      await Instance.disposeAll()
    }
  },
)

test.skipIf(!chrome)(
  "native page-tool contracts pin descriptors, qualify negative input, and export without page evaluation",
  { timeout: 120_000, retry: 0 },
  async () => {
    const { createServer } = await import("node:http")
    const html = `<!doctype html><title>Contract fixture</title><h1>Contract fixture</h1><script>
    const context = document.modelContext ?? navigator.modelContext;
    context.registerTool({ name: 'fixture_lookup', description: 'Read synthetic fixture data', inputSchema: { type: 'object', properties: { value: { type: 'string' } } }, annotations: { readOnlyHint: true }, execute: async ({value}) => { if (!value) throw new Error('Missing fixture input'); return JSON.stringify({value}); } });
  </script>`
    await using discovery = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html")
      response.end(html)
    })
    discovery.listen(0, "127.0.0.1")
    await once(discovery, "listening")
    const address = discovery.address()
    if (!address || typeof address === "string") throw new Error("Missing discovery fixture address")
    const origin = `http://127.0.0.1:${address.port}`
    const entry = {
      ...WebMcpProfile.config(
        { allowedOrigins: [], read: true, interact: true, headless: true, executablePath: chrome },
        true,
      ),
      timeout: 15000,
    }
    await using tmp = await tmpdir({ git: true, config: { mcp: { live: entry } } })
    await fs.writeFile(
      path.join(tmp.path, "server.mjs"),
      `import {createServer} from 'node:http'; createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(${JSON.stringify(html)});}).listen(Number(process.argv[2]),'127.0.0.1');`,
    )
    await fs.writeFile(path.join(tmp.path, ".gitignore"), "node_modules/\nregression.mjs\n")
    const ask = vi.spyOn(Permission, "ask").mockResolvedValue(undefined)
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await MCP.connect("live")
          const tools = await resolveTools({
            agent: { name: "build", permission: [{ permission: "*", pattern: "*", action: "allow" }] },
            session: { id: "ses_contract_live", permission: [] },
            model: { providerID: "test", api: { id: "test", npm: "@ai-sdk/openai-compatible" } },
            tools: {},
            bypassAgentCheck: false,
            messages: [],
            processor: { message: { id: "msg_contract_live" }, partFromToolCall: () => undefined },
          } as never)
          let n = 0
          const options = () => ({
            toolCallId: `contract_${++n}`,
            messages: [],
            abortSignal: new AbortController().signal,
          })
          const raw = await MCP.tools()
          await raw.live_new_page.execute!({ url: origin }, options())
          const pageId = [
            ...WebMcpProfile.parseStructuredPages(await raw.live_list_pages.execute!({}, options()))!,
          ].find(([, url]) => new URL(url).origin === origin)![0]
          const contracts = (await tools.browser_workflow.execute!(
            { action: "contracts", server: "live", pageId },
            options(),
          )) as { output: string }
          const descriptor = (parseJsonStrict(contracts.output) as Array<{ descriptorHash: string }>)[0]!
          await raw.live_close_page.execute!({ pageId }, options())
          const frozen = (await tools.browser_workflow.execute!(
            {
              action: "freeze",
              manifest: {
                version: 1,
                name: "Page-tool contract",
                server: "node server.mjs {port}",
                steps: [
                  {
                    action: "contract",
                    name: "fixture_lookup",
                    descriptorHash: descriptor.descriptorHash,
                    input: { value: "AX" },
                    resultPath: ["value"],
                    equals: "AX",
                  },
                  {
                    action: "contract",
                    name: "fixture_lookup",
                    descriptorHash: descriptor.descriptorHash,
                    input: {},
                    expectError: true,
                    equals: null,
                  },
                ],
              },
            },
            options(),
          )) as { metadata: { scenarioHash: string } }
          const hash = frozen.metadata.scenarioHash
          const run = (await tools.browser_workflow.execute!({ action: "run", hash, server: "live" }, options())) as {
            metadata: { status: string }
            output: string
          }
          expect(run.metadata.status, run.output).toBe("pass")
          const exported = (await tools.browser_workflow.execute!({ action: "export", hash }, options())) as {
            output: string
          }
          await fs.writeFile(path.join(tmp.path, "regression.mjs"), exported.output)
          await fs.mkdir(path.join(tmp.path, "node_modules"), { recursive: true })
          const require = createRequire(import.meta.url)
          await fs.symlink(
            path.dirname(require.resolve("playwright-core/package.json")),
            path.join(tmp.path, "node_modules/playwright-core"),
            "dir",
          )
          for (let repeat = 0; repeat < 2; repeat++) {
            const result = await Process.run([process.execPath, "regression.mjs"], {
              cwd: tmp.path,
              env: { ...process.env, AX_TEST_WEBMCP_CHROME: chrome! },
              timeout: 30000,
              nothrow: true,
            })
            expect(result.code, result.stderr.toString()).toBe(0)
          }
        },
      })
    } finally {
      ask.mockRestore()
      await Instance.disposeAll()
    }
  },
)
