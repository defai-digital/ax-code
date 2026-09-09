import fs from "node:fs/promises"
import { HarnessCapture } from "../src/workflow/harness-capture"
import { HarnessEval } from "../src/workflow/harness-eval"
import { parseJsonStrict } from "../src/util/json-value"

const [action, file, baseline, candidate] = process.argv.slice(2)
if (!file || (action !== "run" && action !== "compare"))
  throw new Error("Usage: tsx script/harness-eval.ts run manifest.json | compare runs.json baseline candidate")
const handle = await fs.open(file, "r")
let input: unknown
try {
  if ((await handle.stat()).size > 8_000_000) throw new Error("Harness input exceeds 8MB")
  const buffer = Buffer.alloc(8_000_001)
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
  if (bytesRead > 8_000_000) throw new Error("Harness input exceeds 8MB")
  const text = buffer.subarray(0, bytesRead).toString("utf8")
  input = action === "compare" ? HarnessEval.records(text) : parseJsonStrict(text)
} finally {
  await handle.close()
}
if (action === "compare") {
  if (!baseline || !candidate) throw new Error("Baseline and candidate arm names are required")
  process.stdout.write(JSON.stringify(HarnessEval.compare(input, baseline, candidate), null, 2) + "\n")
} else {
  const controller = new AbortController()
  const cancel = () => controller.abort(new Error("Harness capture cancelled"))
  process.once("SIGINT", cancel)
  process.once("SIGTERM", cancel)
  try {
    const result = await HarnessCapture.run(input, {
      abort: controller.signal,
      async record(run) {
        process.stdout.write(JSON.stringify({ type: "run", run }) + "\n")
      },
    })
    process.stdout.write(
      JSON.stringify({ type: "comparison", comparison: result.comparison, incomplete: result.incomplete }) + "\n",
    )
    if (result.incomplete) process.exitCode = 1
  } finally {
    process.removeListener("SIGINT", cancel)
    process.removeListener("SIGTERM", cancel)
  }
}
