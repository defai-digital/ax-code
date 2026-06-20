import { afterEach, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("GET /capability returns unified catalog entries for the requested directory", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const commandDir = path.join(dir, ".agents", "commands")
      await fs.mkdir(commandDir, { recursive: true })
      await Bun.write(
        path.join(commandDir, "server-check.md"),
        `---
description: Server catalog check
---
Check server catalog.
`,
      )
    },
  })

  const app = Server.Default()
  const response = await app.request(`/capability?directory=${encodeURIComponent(tmp.path)}`)
  expect(response.status).toBe(200)
  const capabilities = (await response.json()) as Array<{ kind: string; name: string; sourceTool?: string }>

  expect(capabilities).toContainEqual(expect.objectContaining({ kind: "command", name: "server-check" }))
  expect(capabilities).toContainEqual(expect.objectContaining({ kind: "agent", name: "build" }))
  expect(capabilities).toContainEqual(expect.objectContaining({ kind: "workflow", name: "builtin:noop-dry-run" }))
})
