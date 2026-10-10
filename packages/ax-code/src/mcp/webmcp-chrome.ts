import { execFile } from "node:child_process"
import { promisify } from "node:util"
import os from "node:os"
import path from "node:path"
import z from "zod"
import { Config } from "../config/config"
import { Filesystem } from "../util/filesystem"
import { WebMcpProfile } from "./webmcp-profile"

const execFileAsync = promisify(execFile)

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

  /** Well-known install locations; PATH names are resolved by {@link pathCandidates}. */
  export function knownPaths(platform: NodeJS.Platform, home = os.homedir(), env = process.env): string[] {
    if (platform === "darwin") {
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ]
    }
    if (platform === "win32") {
      return [env["ProgramFiles"], env["ProgramFiles(x86)"], env["LOCALAPPDATA"]]
        .filter((root): root is string => !!root)
        .map((root) => path.join(root, "Google", "Chrome", "Application", "chrome.exe"))
    }
    return []
  }

  const PATH_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]

  export function pathCandidates(platform: NodeJS.Platform, env = process.env): string[] {
    if (platform === "win32") return []
    const dirs = (env["PATH"] ?? "").split(path.delimiter).filter(Boolean)
    return dirs.flatMap((dir) => PATH_NAMES.map((name) => path.join(dir, name)))
  }

  async function version(executable: string): Promise<number | undefined> {
    try {
      const { stdout } = await execFileAsync(executable, ["--version"], { encoding: "utf8", timeout: 10_000 })
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
    const candidates = executablePath ? [executablePath] : [...knownPaths(platform), ...pathCandidates(platform)]
    let best: { executable: string; major: number } | undefined
    let unreadable: string | undefined
    for (const executable of candidates) {
      if (!(await Filesystem.isExecutable(executable))) continue
      // Windows `chrome.exe --version` opens a window instead of printing, so
      // an installed binary counts as present without a version.
      if (platform === "win32") return { state: "ready", executable }
      const major = await version(executable)
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
    const profile = WebMcpProfile.validateLaunch(entry)
    if (!profile) return undefined
    return status(profile.executablePath)
  }
}
