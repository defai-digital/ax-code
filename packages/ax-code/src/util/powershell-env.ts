import path from "node:path"

/** Let Windows PowerShell rebuild its module paths after an intermediate Node process. */
export function powershellEnvironment(command: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const name = path.win32.basename(command).toLowerCase()
  if (name !== "powershell" && name !== "powershell.exe") return { ...env }
  // PowerShell 7 only removes its module paths when it launches powershell.exe
  // directly. Inheriting them through Node prevents standard 5.1 module loading.
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== "PSMODULEPATH"))
}
