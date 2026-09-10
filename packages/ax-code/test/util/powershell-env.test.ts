import { describe, expect, test } from "vitest"
import { powershellEnvironment } from "../../src/util/powershell-env"

describe("managed PowerShell child environment", () => {
  test.each(["powershell", "powershell.exe", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.EXE"])(
    "%s drops inherited module paths without changing its parent or other variables",
    (command) => {
      const inherited = {
        PSModulePath: "incompatible modules",
        psmodulepath: "alternate casing",
        Path: "tools",
        TEMP: "temp",
      }
      expect(powershellEnvironment(command, inherited)).toEqual({ Path: "tools", TEMP: "temp" })
      expect(inherited.PSModulePath).toBe("incompatible modules")
      expect(inherited.psmodulepath).toBe("alternate casing")
    },
  )

  test.each(["pwsh", "C:\\Program Files\\PowerShell\\7\\pwsh.exe", "bash", "powershell-custom"])(
    "%s retains its intended module environment",
    (command) => {
      const inherited = { PSModulePath: "configured modules", Path: "tools" }
      const result = powershellEnvironment(command, inherited)
      expect(result).toEqual(inherited)
      expect(result).not.toBe(inherited)
    },
  )
})
