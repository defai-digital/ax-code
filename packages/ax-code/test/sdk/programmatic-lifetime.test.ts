import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest"
import z from "zod"
import { createAgent } from "../../src/sdk/programmatic"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

beforeAll(() => {
  for (const name of ["AGENT", "AX_CODE", "OPENCODE", "AX_CODE_PID"]) vi.stubEnv(name, process.env[name])
})

afterAll(() => {
  vi.unstubAllEnvs()
})

afterEach(async () => {
  await Instance.disposeAll()
})

test.each([0, 1])("disposing SDK agent %s preserves another agent's project resources", async (closed) => {
  await using tmp = await tmpdir()
  const agents: Awaited<ReturnType<typeof createAgent>>[] = []
  try {
    for (const name of ["first_agent_probe", "second_agent_probe"]) {
      agents.push(
        await createAgent({
          directory: tmp.path,
          tools: [
            {
              __brand: "SdkTool",
              name,
              description: "Lifecycle probe",
              parameters: z.object({}),
              execute: () => "unused",
            },
          ],
        }),
      )
    }
    const remaining = closed === 0 ? 1 : 0
    const toolName = remaining === 0 ? "first_agent_probe" : "second_agent_probe"
    expect(await agents[remaining]!.tools()).toContain(toolName)
    await agents[closed]!.dispose()
    expect(await agents[remaining]!.tools()).toContain(toolName)
    const session = await agents[remaining]!.session()
    expect(await session.messages()).toEqual([])
    await agents[remaining]!.dispose()
    expect(Instance.list()).not.toContain(tmp.path)
  } finally {
    await Promise.all(agents.map((agent) => agent.dispose()))
  }
})
