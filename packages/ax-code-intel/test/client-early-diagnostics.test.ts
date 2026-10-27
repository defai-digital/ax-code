import { spawn } from "node:child_process"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { expect, test } from "vitest"
import { tmpdir } from "./harness"
import { LSPClient } from "../src/client"

test("diagnostics published before the client finishes starting are kept", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "a.ts")
  const serverPath = fileURLToPath(new URL("./fixture/fake-lsp-server.js", import.meta.url))
  const process = spawn(globalThis.process.execPath, [serverPath], {
    stdio: "pipe",
    env: { ...globalThis.process.env, FAKE_LSP_PUBLISH_ON_INITIALIZE: pathToFileURL(file).href },
  })
  const client = await LSPClient.create({ serverID: "fake", server: { process }, root: tmp.path })
  try {
    // The publish rides in right behind the initialize reply, so it is
    // handled while create() is still running.
    await new Promise((resolve) => setTimeout(resolve, 100))
    const cached = [...client.diagnostics.entries()].find(([key]) => path.basename(key) === "a.ts")
    expect(cached?.[1].map((d) => d.message)).toEqual(["early"])
  } finally {
    await client.shutdown()
    process.kill("SIGKILL")
  }
})
