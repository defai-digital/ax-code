// Temporary live probe: dumps raw observe() output from both backends.
// Run: AX_COMPUTER_PROBE=1 AX_COMPUTER_OCU_COMMAND=... AX_COMPUTER_CUA_COMMAND=... vitest run test/probe.live.test.ts
import { describe, test } from "vitest"
import { CuaProvider } from "../src/providers/cua"
import { OcuProvider } from "../src/providers/ocu"

const probe = process.env.AX_COMPUTER_PROBE === "1"
const app = process.env.AX_COMPUTER_LIVE_APP ?? "TextEdit"

function summarize(obs: unknown) {
  const s = JSON.stringify(obs, (key, value) =>
    key === "data" && typeof value === "string" ? `<base64 ${value.length} chars>` : value,
  )
  return s.length > 4000 ? s.slice(0, 4000) + "…<truncated>" : s
}

describe.skipIf(!probe)("live probe", () => {
  test("ocu observe", { timeout: 120_000 }, async () => {
    const provider = new OcuProvider({ command: process.env.AX_COMPUTER_OCU_COMMAND })
    try {
      const apps = await provider.listApps()
      console.log("OCU listApps count:", apps.length, "sample:", JSON.stringify(apps.slice(0, 3)))
      const obs = await provider.observe({ app })
      console.log("OCU observe:", summarize(obs))
    } finally {
      await provider.dispose()
    }
  })

  test("cua observe", { timeout: 120_000 }, async () => {
    const provider = new CuaProvider({ command: process.env.AX_COMPUTER_CUA_COMMAND })
    try {
      const apps = await provider.listApps()
      console.log("CUA listApps count:", apps.length, "sample:", JSON.stringify(apps.slice(0, 3)))
      const windows = await provider.listWindows?.()
      console.log("CUA listWindows:", summarize(windows))
      const obs = await provider.observe({ app })
      console.log("CUA observe app:", summarize(obs))
      const desktop = await provider.observe({ desktop: true })
      console.log("CUA observe desktop:", summarize(desktop))
    } finally {
      await provider.dispose()
    }
  })
})
