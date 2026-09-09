import path from "path"
import z from "zod"
import { parseJsonStrict } from "../../util/json-value"

const WindowsProcess = z.object({
  ProcessId: z.number().int().nonnegative(),
  ParentProcessId: z.number().int().nonnegative(),
  Name: z.string(),
  CommandLine: z.string().nullable(),
})

export const WINDOWS_PROCESS_COMMAND = [
  "powershell.exe",
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "$ErrorActionPreference = 'Stop'; $OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress",
]

export function parseWindowsAxCodeProcesses(raw: string) {
  const data = parseJsonStrict(raw.replace(/^\uFEFF/, ""))
  const rows = z.array(WindowsProcess).parse(Array.isArray(data) ? data : [data])
  const processes: { pid: number; parent: number; command: string; readOnly: boolean }[] = []
  for (const row of rows) {
    const name = row.Name.toLowerCase()
    if (!["node.exe", "node", "ax-code.exe", "ax-code"].includes(name)) continue
    if (row.ProcessId === 0) throw new Error("Invalid application process ID")
    if (row.CommandLine === null) throw new Error("Process command line unavailable")
    if ((row.CommandLine.match(/"/g)?.length ?? 0) % 2) throw new Error("Malformed process command line")
    const args = (row.CommandLine.match(/(?:[^\s"]|"[^"]*")+/g) ?? []).map((arg) => arg.replaceAll('"', ""))
    let commandArgs = args.slice(1)
    if (name.startsWith("node")) {
      // Inspect the executable script argument, never arbitrary payload arguments.
      let index = 0
      while (index < commandArgs.length && commandArgs[index].startsWith("-")) {
        const flag = commandArgs[index++]
        if (["--import", "--require", "-r", "--loader", "--experimental-loader", "--conditions", "-C"].includes(flag))
          index++
      }
      if (index >= commandArgs.length) continue
      const script = path.win32.normalize(commandArgs[index]).replaceAll("\\", "/").toLowerCase()
      const entrypoint =
        /\/(?:\.ax-code|ax-code)(?:\/(?:lib|src|dist|bin))?\/(?:index-node(?:-tui)?|index-compiled|index)\.(?:js|ts)$/.test(
          script,
        ) || /\/(?:ax-code-runtime|runtime)\/index-node(?:-tui)?\.js$/.test(script)
      if (!entrypoint) continue
      commandArgs = commandArgs.slice(index + 1)
    }
    processes.push({
      pid: row.ProcessId,
      parent: row.ParentProcessId,
      command: commandArgs.join(" "),
      readOnly: isReadOnly(commandArgs),
    })
  }
  return processes
}

function isReadOnly(args: string[]) {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--version" || arg === "-v") return true
    if (["--cwd", "--log-level", "--model", "-m", "--agent"].includes(arg)) {
      index++
      continue
    }
    if (arg.startsWith("-")) continue
    return arg === "doctor" || arg === "tui-backend"
  }
  return false
}
