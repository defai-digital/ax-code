/**
 * Example: Using the ax-code Programmatic SDK
 *
 * Run with: bun run packages/sdk/js/example/programmatic.ts
 */

import { createAgent } from "@ax-code/sdk/programmatic"

async function example1_oneShot() {
  console.log("=== Example 1: One-Shot ===\n")

  const agent = await createAgent({
    directory: process.cwd(),
  })

  const result = await agent.run("What files are in the src/ directory?")
  console.log("Response:", result.text)
  console.log("Agent:", result.agent)
  console.log("Tokens:", result.usage.totalTokens)

  await agent.dispose()
}

async function example2_streaming() {
  console.log("\n=== Example 2: Streaming ===\n")

  const agent = await createAgent({
    directory: process.cwd(),
  })

  for await (const event of agent.stream("Explain what src/auth/index.ts does")) {
    switch (event.type) {
      case "text":
        process.stdout.write(event.text)
        break
      case "tool-call":
        console.log(`\n[Tool: ${event.tool}]`)
        break
      case "tool-result":
        console.log(`[Tool ${event.tool}: ${event.status}]`)
        break
      case "done":
        console.log(`\n\nTokens: ${event.result.usage.totalTokens}`)
        break
    }
  }

  await agent.dispose()
}

async function example3_multiTurn() {
  console.log("\n=== Example 3: Multi-Turn ===\n")

  const agent = await createAgent({
    directory: process.cwd(),
    agent: "build",
  })

  const session = await agent.session()

  const r1 = await session.run("Read src/auth/index.ts")
  console.log("Turn 1:", r1.text.slice(0, 200) + "...")

  const r2 = await session.run("What security measures does it use?")
  console.log("Turn 2:", r2.text.slice(0, 200) + "...")

  await agent.dispose()
}

async function example4_securityScan() {
  console.log("\n=== Example 4: Security Scan (CI/CD) ===\n")

  const agent = await createAgent({
    directory: process.cwd(),
    agent: "security",
    hooks: {
      onToolCall(tool, input) {
        console.log(`  Scanning with ${tool}...`)
        return true // allow all tools
      },
      onPermissionRequest() {
        return "allow" // auto-approve in CI
      },
    },
  })

  const result = await agent.run("Scan src/auth/ for security vulnerabilities")
  console.log("Findings:", result.text)

  // CI/CD gate
  if (result.text.toLowerCase().includes("high")) {
    console.log("FAIL: High severity issues found")
    process.exitCode = 1
  } else {
    console.log("PASS: No high severity issues")
  }

  await agent.dispose()
}

// Run examples
const example = process.argv[2] ?? "1"
switch (example) {
  case "1":
    await example1_oneShot()
    break
  case "2":
    await example2_streaming()
    break
  case "3":
    await example3_multiTurn()
    break
  case "4":
    await example4_securityScan()
    break
  default:
    console.log("Usage: bun run programmatic.ts [1|2|3|4]")
}
