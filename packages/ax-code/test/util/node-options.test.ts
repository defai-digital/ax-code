import { describe, expect, test } from "vitest"
import { AX_CODE_LAUNCH_NODE_OPTIONS, restoreAxCodeLaunchNodeOptions } from "../../src/util/node-options"

describe("launch NODE_OPTIONS restore", () => {
  test("restores the caller's NODE_OPTIONS saved by the launcher", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_OPTIONS: "--experimental-ffi --import /opt/ax-code/lib/index-node-tui.js --max-old-space-size=4096",
      [AX_CODE_LAUNCH_NODE_OPTIONS]: "--max-old-space-size=4096",
    }

    expect(restoreAxCodeLaunchNodeOptions(env)).toBe(true)
    expect(env["NODE_OPTIONS"]).toBe("--max-old-space-size=4096")
    expect(AX_CODE_LAUNCH_NODE_OPTIONS in env).toBe(false)
  })

  test("deletes the augmented NODE_OPTIONS when the caller had none", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_OPTIONS: "--experimental-ffi --import /opt/ax-code/lib/index-node-tui.js",
      [AX_CODE_LAUNCH_NODE_OPTIONS]: "",
    }

    expect(restoreAxCodeLaunchNodeOptions(env)).toBe(true)
    expect("NODE_OPTIONS" in env).toBe(false)
    expect(AX_CODE_LAUNCH_NODE_OPTIONS in env).toBe(false)
  })

  test("is a no-op outside launcher sessions", () => {
    const env: NodeJS.ProcessEnv = { NODE_OPTIONS: "--inspect" }

    expect(restoreAxCodeLaunchNodeOptions(env)).toBe(false)
    expect(env["NODE_OPTIONS"]).toBe("--inspect")
  })
})
