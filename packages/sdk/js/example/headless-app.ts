import {
  applyHeadlessProjectionEvent,
  createHeadlessClient,
  createHeadlessProjectionState,
  startHeadlessBackend,
} from "@ax-code/sdk/headless"

const directory = process.argv[2] ?? process.cwd()
const backend = await startHeadlessBackend({ directory })

try {
  const client = createHeadlessClient({
    baseUrl: backend.url,
    directory,
    headers: backend.headers,
  })
  const state = createHeadlessProjectionState()
  const session = await client.createSession({ title: "Headless app example" })

  await client.sendPrompt(session.id, {
    parts: [{ type: "text", text: "Summarize this project for an app UI." }],
  })

  for await (const event of client.subscribe()) {
    applyHeadlessProjectionEvent(state, event)
    if (state.permission[session.id]?.length || state.question[session.id]?.length) {
      break
    }
    if (state.session_status[session.id]?.type === "idle") {
      break
    }
  }
} finally {
  await backend.close()
}
