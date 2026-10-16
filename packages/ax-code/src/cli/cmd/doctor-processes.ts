import path from "path"
import z from "zod"
import { parseJsonStrict } from "../../util/json-value"
import { ProcessRegistry } from "../../runtime/process-registry"

export type DoctorCheck = {
  name: string
  status: "ok" | "warn" | "fail"
  detail: string
}

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

const REGISTERED_ENTRIES_SHOWN = 8

/**
 * Child-process registry row for `ax-code doctor` (ADR-209): lists the
 * children registered by live ax-code instances, any orphaned or
 * unverifiable entries the startup sweep left behind, and what this
 * process's own startup sweep did.
 */
export async function getDoctorProcessRegistryCheck(input?: {
  platform?: NodeJS.Platform
  list?: () => Promise<ProcessRegistry.ListedProcess[]>
  lastSweep?: () => { report: ProcessRegistry.SweepReport; at: number } | undefined
}): Promise<DoctorCheck> {
  const platform = input?.platform ?? process.platform
  const list = input?.list ?? (() => ProcessRegistry.list({ platform }))
  const lastSweep = input?.lastSweep ?? ProcessRegistry.lastSweepReport

  const entries = await list()
  const sweep = lastSweep()
  const details: string[] = []
  let status: DoctorCheck["status"] = "ok"

  if (entries.length === 0) {
    details.push(platform === "win32" ? "child process registry disabled (windows)" : "no registered child processes")
  } else {
    const perKind = new Map<string, number>()
    for (const item of entries) perKind.set(item.entry.kind, (perKind.get(item.entry.kind) ?? 0) + 1)
    const counts = [...perKind.entries()].map(([kind, count]) => `${count} ${kind}`).join(", ")
    const orphans = entries.filter((item) => item.state === "orphan")
    const unverified = entries.filter((item) => item.state === "unverified")
    const stale = entries.filter((item) => item.state === "dead" || item.state === "pid-reused")
    const live = entries.filter((item) => item.state === "live-owner")
    details.push(
      `${entries.length} registered child process(es): ${counts} — ` +
        (live.length === entries.length
          ? "all owners alive"
          : `${live.length} with live owners, ${orphans.length} orphaned, ${unverified.length} unverifiable, ${stale.length} stale`),
    )
    const shown = entries.slice(0, REGISTERED_ENTRIES_SHOWN)
    const hidden = entries.length - shown.length
    details.push(
      shown
        .map((item) => {
          const label = `${item.entry.kind} pid ${item.entry.pid} (${item.entry.commandBase})`
          return item.state === "orphan" || item.state === "unverified" ? `${item.state}: ${label}` : label
        })
        .join(", ") + (hidden > 0 ? `, +${hidden} more` : ""),
    )
    if (orphans.length + unverified.length > 0) {
      status = "warn"
      details.push(
        "orphaned or unverifiable entries remain — the startup sweep did not clear them; inspect these processes before removing the state directory",
      )
    }
  }

  if (sweep) {
    const { report } = sweep
    const summary =
      `startup sweep: ${report.killed} killed, ${report.alreadyDead} already dead, ` +
      `${report.pidReused} pid-reuse skipped, ${report.unverified} unverified, ${report.keptLiveOwner} kept (live owners)`
    details.push(report.skipped ? `${summary} (skipped on windows)` : summary)
    if (report.errors.length > 0) {
      status = "warn"
      details.push(`sweep reported ${report.errors.length} error(s)`)
    }
  } else if (platform !== "win32") {
    details.push("startup sweep not recorded in this process")
  }

  return {
    name: "Child processes",
    status,
    detail: details.join("; "),
  }
}
