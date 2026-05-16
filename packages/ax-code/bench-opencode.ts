import { spawn } from "node:child_process"

console.log("=== OPENCODE EXTERNAL SERVER SPAWN ===")
const s = Date.now()

// This is how OpenCode SDK works — spawns a server process
const proc = spawn("ax-code", ["serve", "--hostname=127.0.0.1", "--port=4098"], {
  env: { ...process.env },
})

const url = await new Promise<string>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timeout")), 30000)
  let output = ""
  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString()
    const match = output.match(/listening on\s+(https?:\/\/[^\s]+)/)
    if (match) {
      clearTimeout(timeout)
      resolve(match[1])
    }
  })
  proc.stderr?.on("data", (chunk) => {
    output += chunk.toString()
  })
  proc.on("error", (e) => {
    clearTimeout(timeout)
    reject(e)
  })
  proc.on("exit", (code) => {
    clearTimeout(timeout)
    reject(new Error("Exited: " + code + "\n" + output))
  })
})

const spawnTime = Date.now() - s
console.log("Spawn server:", spawnTime, "ms")
console.log("Server URL:", url)

// Now create client and session
const { createOpencodeClient } = await import("@ax-code/sdk")
const client = createOpencodeClient({ baseUrl: url })

const s2 = Date.now()
const session = await client.session.create()
console.log("Create session:", Date.now() - s2, "ms")
console.log("TOTAL:", Date.now() - s, "ms")

proc.kill()
process.exit(0)
