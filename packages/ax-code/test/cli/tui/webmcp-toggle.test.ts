import { describe, expect, test } from "vitest"
import { toggleWebMcpBridges } from "../../../src/cli/tui/component/webmcp-toggle"

/**
 * The chip toggle must never wait on the advisory Chrome probe: the connects
 * settle on their own, and a notice (if any) arrives whenever the probe does.
 */
describe("toggleWebMcpBridges", () => {
  test("connects settle before a slow probe answers; the notice still arrives", async () => {
    const calls: string[] = []
    const warnings: string[] = []
    let answer!: (status: { state: "missing"; minimum: number }) => void
    const probe = new Promise<{ state: "missing"; minimum: number }>((resolve) => {
      answer = resolve
    })
    const done = toggleWebMcpBridges({
      model: { servers: ["bridge"], connected: [], attentions: [] },
      statusOf: () => "disabled",
      toggle: async (name) => {
        calls.push(`toggle:${name}`)
      },
      chrome: () => probe,
      warn: (notice) => warnings.push(notice.key),
    })
    await done
    expect(calls).toEqual(["toggle:bridge"])
    expect(warnings).toEqual([])
    answer({ state: "missing", minimum: 150 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(warnings).toEqual(["ui.webMcpChromeMissing"])
  })

  test("a rejected probe and a rejected toggle are both contained", async () => {
    const warnings: string[] = []
    await expect(
      toggleWebMcpBridges({
        model: { servers: ["bridge"], connected: [], attentions: [] },
        statusOf: () => "failed",
        toggle: async () => {
          throw new Error("connect failed")
        },
        chrome: async () => {
          throw new Error("probe failed")
        },
        warn: (notice) => warnings.push(notice.key),
      }),
    ).resolves.toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(warnings).toEqual([])
  })

  test("a live bridge is disconnected and attention bridges are retried without probing", async () => {
    const calls: string[] = []
    let probed = false
    await toggleWebMcpBridges({
      model: { servers: ["a", "b"], connected: ["a"], attentions: [{ name: "b" }] },
      statusOf: () => "connected",
      toggle: async (name) => {
        calls.push(name)
      },
      chrome: async () => {
        probed = true
        return undefined
      },
      warn: () => undefined,
    })
    expect(calls.sort()).toEqual(["a", "b"])
    expect(probed).toBe(false)
  })
})
