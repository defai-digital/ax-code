/**
 * Head-to-head benchmark: OpenCode SDK approach vs ax-code Programmatic SDK
 * Both do the same thing: create session + send prompt + get response
 * Same machine, same provider, same prompt, same directory
 */

console.log("=".repeat(60))
console.log("  BENCHMARK: OpenCode SDK vs ax-code Programmatic SDK")
console.log("=".repeat(60))

// ============================================
// TEST 1: OpenCode SDK approach (spawn server)
// This is how an external developer uses OpenCode
// ============================================
console.log("\n--- TEST 1: OpenCode SDK (spawn server process) ---")
console.log("What external developer does:")
console.log("  1. createOpencodeServer() — spawns ax-code serve")
console.log("  2. createOpencodeClient() — HTTP client")
console.log("  3. client.session.create() — create session via HTTP")
console.log("  4. client.event.subscribe() — subscribe SSE")
console.log("  5. client.session.prompt() — send prompt via HTTP")
console.log("  6. for await events — wait for response via SSE")
console.log("  7. server.close() — kill server process")
console.log("")

const opencode_start = Date.now()
try {
  const { spawn } = await import("node:child_process")

  // Step 1: Spawn server
  const s1 = Date.now()
  const proc = spawn("ax-code", ["serve", "--hostname=127.0.0.1", "--port=4099"], {
    env: { ...process.env },
  })

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server spawn timeout (30s)")), 30000)
    let output = ""
    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString()
      const match = output.match(/listening on\s+(https?:\/\/[^\s]+)/)
      if (match) {
        clearTimeout(timeout)
        resolve(match[1])
      }
    })
    proc.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString()
    })
    proc.on("error", (e: Error) => {
      clearTimeout(timeout)
      reject(e)
    })
    proc.on("exit", (code: number) => {
      clearTimeout(timeout)
      reject(new Error("Server exited: " + code))
    })
  })
  const spawn_time = Date.now() - s1
  console.log("  Step 1 - Spawn server:", spawn_time, "ms")

  // Step 2: Create client
  const { createOpencodeClient } = await import("@ax-code/sdk/v2/client")
  const client = createOpencodeClient({ baseUrl: url })
  console.log("  Step 2 - Create client: 0 ms")

  // Step 3: Create session
  const s3 = Date.now()
  const session = await client.session.create()
  const session_time = Date.now() - s3
  console.log("  Step 3 - Create session:", session_time, "ms")

  // Step 4: Subscribe events
  const s4 = Date.now()
  const events = await client.event.subscribe()
  const sub_time = Date.now() - s4
  console.log("  Step 4 - Subscribe events:", sub_time, "ms")

  // Step 5+6: Send prompt + wait for response
  const sessionID = (session.data as any)?.id
  const s5 = Date.now()

  let got_response = false
  const response_promise = (async () => {
    for await (const event of events.stream) {
      if (event.type === "session.status") {
        const props = (event as any).properties
        if (props.sessionID === sessionID && props.status?.type === "idle") {
          got_response = true
          return
        }
      }
    }
  })()

  await client.session.prompt({
    sessionID,
    parts: [{ type: "text", text: "What is 2+2? One word." }],
  })

  // Wait max 60 seconds for response
  const timeout_promise = new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error("Response timeout (60s)")), 60000),
  )

  try {
    await Promise.race([response_promise, timeout_promise])
    const prompt_time = Date.now() - s5
    console.log("  Step 5+6 - Prompt + response:", prompt_time, "ms")
  } catch (e: any) {
    console.log("  Step 5+6 - FAILED:", e.message)
  }

  // Step 7: Cleanup
  proc.kill()

  const opencode_total = Date.now() - opencode_start
  console.log("\n  OPENCODE TOTAL:", opencode_total, "ms")
  console.log("  Got response:", got_response)
} catch (e: any) {
  console.log("  OPENCODE FAILED:", e.message)
  console.log("  Time before failure:", Date.now() - opencode_start, "ms")
}

// ============================================
// TEST 2: ax-code Programmatic SDK
// This is how an external developer uses our SDK
// ============================================
console.log("\n--- TEST 2: ax-code Programmatic SDK ---")
console.log("What external developer does:")
console.log("  1. createAgent() — in-process, no server")
console.log("  2. agent.run() — send prompt, get result")
console.log("  3. agent.dispose() — cleanup")
console.log("")

const axcode_start = Date.now()
try {
  // Step 1: Create agent
  const { createAgent } = await import("./src/sdk/programmatic.ts")
  const s1 = Date.now()
  const agent = await createAgent({ directory: process.cwd() })
  const create_time = Date.now() - s1
  console.log("  Step 1 - createAgent():", create_time, "ms")

  // Step 2: Run prompt
  const s2 = Date.now()
  const result = await agent.run("What is 2+2? One word.")
  const run_time = Date.now() - s2
  console.log("  Step 2 - agent.run():", run_time, "ms")
  console.log("  Result:", result.text)
  console.log("  Tokens:", result.usage.totalTokens)

  // Step 3: Cleanup
  await agent.dispose()

  const axcode_total = Date.now() - axcode_start
  console.log("\n  AX-CODE TOTAL:", axcode_total, "ms")
  console.log("  Got response: true")
} catch (e: any) {
  console.log("  AX-CODE FAILED:", e.message)
  console.log("  Time before failure:", Date.now() - axcode_start, "ms")
}

// ============================================
// COMPARISON
// ============================================
console.log("\n" + "=".repeat(60))
console.log("  COMPARISON COMPLETE")
console.log("=".repeat(60))

process.exit(0)
