import { execFile } from "node:child_process"
import { promisify } from "node:util"
import os from "node:os"
import nodePath from "node:path"
import z from "zod"
import { Config } from "../config/config"
import { Filesystem } from "../util/filesystem"
import { McpTrust } from "./trust"
import { WebMcpProfile } from "./webmcp-profile"

const execFileAsync = promisify(execFile)

/** os.homedir() throws in minimal environments (no HOME, no passwd entry); the probe then has no user-relative candidates. */
function safeHomedir(): string {
  try {
    return os.homedir()
  } catch {
    return ""
  }
}

/**
 * Best-effort, read-only Chrome detection for the WebMCP chip (ADR-180). It
 * only runs `<chrome> --version` on an explicit or well-known executable, so it
 * never starts a browser and never replaces the launch-time preflight. A
 * `missing` or `outdated` answer is advice for the user, not a gate: the
 * bridge may still find a Chrome in a place this probe does not know.
 */
export namespace WebMcpChrome {
  export const Status = z.discriminatedUnion("state", [
    z.object({ state: z.literal("ready"), major: z.number().int().optional(), executable: z.string() }),
    z.object({ state: z.literal("outdated"), major: z.number().int(), minimum: z.number().int() }),
    z.object({ state: z.literal("missing"), minimum: z.number().int() }),
    z.object({ state: z.literal("unreadable"), executable: z.string(), reason: z.string() }),
  ])
  export type Status = z.infer<typeof Status>

  // Discovery must not execute a project-relative binary through a relative
  // HOME/install/PATH entry. Keep fixed browser names inside an absolute root.
  function candidatePath(platform: NodeJS.Platform, root: string, ...parts: string[]): string[] {
    const path = platform === "win32" ? nodePath.win32 : nodePath.posix
    if (!path.isAbsolute(root)) return []
    const candidate = path.join(root, ...parts)
    const relative = path.relative(root, candidate)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return []
    return [candidate]
  }

  /** Well-known install locations; PATH names are resolved by {@link pathCandidates}. */
  export function knownPaths(platform: NodeJS.Platform, home = safeHomedir(), env = process.env): string[] {
    if (platform === "darwin") {
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ...candidatePath(platform, home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ]
    }
    if (platform === "win32") {
      return [env["ProgramFiles"], env["ProgramFiles(x86)"], env["LOCALAPPDATA"]]
        .filter((root): root is string => !!root)
        .flatMap((root) => candidatePath(platform, root, "Google", "Chrome", "Application", "chrome.exe"))
    }
    return []
  }

  const PATH_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]

  export function pathCandidates(platform: NodeJS.Platform, env = process.env): string[] {
    if (platform === "win32") return []
    const dirs = (env["PATH"] ?? "").split(":").filter(Boolean)
    return dirs.flatMap((dir) => PATH_NAMES.flatMap((name) => candidatePath(platform, dir, name)))
  }

  async function version(executable: string): Promise<number | undefined> {
    try {
      const { stdout } = await execFileAsync(executable, ["--version"], {
        encoding: "utf8",
        timeout: 10_000,
        // SIGKILL so a binary that ignores SIGTERM cannot keep the advisory
        // probe pending forever; the timeout then bounds the wait.
        killSignal: "SIGKILL",
      })
      return WebMcpProfile.chromeMajor(stdout)
    } catch {
      return undefined
    }
  }

  /**
   * Resolve the status for an optional explicit executable. An explicit path
   * is authoritative: it is the one the bridge will launch, so a stale binary
   * is reported as such instead of falling back to another install.
   */
  export async function status(executablePath?: string, platform: NodeJS.Platform = process.platform): Promise<Status> {
    const minimum = WebMcpProfile.MIN_CHROME_MAJOR
    // A duplicated PATH entry or a HOME that coincides with a fixed install
    // root must not probe the same binary twice.
    const candidates = [
      ...new Set(executablePath ? [executablePath] : [...knownPaths(platform), ...pathCandidates(platform)]),
    ]
    const executables: string[] = []
    for (const executable of candidates) {
      if (!(await Filesystem.isExecutable(executable))) continue
      // Windows `chrome.exe --version` opens a window instead of printing, so
      // an installed binary counts as present without a version.
      if (platform === "win32") return { state: "ready", executable }
      executables.push(executable)
    }
    // Probe every installed candidate at once and read the answers in
    // candidate order: a binary that hangs until its 10 s kill bounds the
    // whole probe to one timeout instead of one per candidate.
    const majors = await Promise.all(executables.map((executable) => version(executable)))
    let best: { executable: string; major: number } | undefined
    let unreadable: string | undefined
    for (const [index, executable] of executables.entries()) {
      const major = majors[index]
      if (major === undefined) {
        unreadable ??= executable
        continue
      }
      if (major >= minimum) return { state: "ready", major, executable }
      if (!best || major > best.major) best = { executable, major }
    }
    if (best) return { state: "outdated", major: best.major, minimum }
    if (unreadable) return { state: "unreadable", executable: unreadable, reason: "could not read the Chrome version" }
    return { state: "missing", minimum }
  }

  /** Status for the Chrome a configured WebMCP bridge would launch. */
  export async function statusForServer(server: string): Promise<Status | undefined> {
    const cfg = await Config.get()
    const entry = cfg.mcp?.[server]
    if (!entry || !("type" in entry) || entry.type !== "local" || !entry.webmcp) return undefined
    // validateLaunch throws on an invalid profile (schema, environment
    // overrides) — an advisory probe reports "not a launchable bridge"
    // instead of rejecting into the route handler.
    let profile: WebMcpProfile.Configuration | undefined
    try {
      profile = WebMcpProfile.validateLaunch(entry)
    } catch {
      return undefined
    }
    if (!profile || !WebMcpProfile.evaluate(cfg.webmcp, profile).ok) return undefined
    // An advisory probe is still process execution. A project-supplied
    // executable must pass the same config-source trust gate as MCP launch;
    // fetching status is not an explicit connect/trust gesture.
    if (profile.executablePath) {
      const source = (await Config.mcpEntry(server))?.source ?? Config.trustedMcpSource("unknown")
      if (!(await McpTrust.decision(server, entry, source)).trusted) return undefined
    }
    return status(profile.executablePath)
  }
}
