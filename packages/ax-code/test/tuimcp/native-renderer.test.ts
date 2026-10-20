import { expect, test } from "vitest"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

test("debug adapter captures and drives the installed native renderer", async () => {
  const result = await promisify(execFile)(
    process.execPath,
    [
      fileURLToPath(new URL("../../../../script/node-ffi-runner.mjs", import.meta.url)),
      "--import",
      "tsx",
      "--conditions=node",
      fileURLToPath(new URL("./native-renderer.ts", import.meta.url)),
    ],
    { cwd: fileURLToPath(new URL("../../", import.meta.url)), timeout: 20_000 },
  )
  expect(result.stdout).toContain("Native TUI snapshot, focus, paste, key, resize and redaction verified")
}, 25_000)
