/**
 * Opt-in OS-level isolation for bash (ADR-048 Phase 2).
 *
 * App-layer isolation remains the portable default. When `backend` is `os` or
 * `auto` and the platform supports a kernel sandbox, bash is wrapped so the
 * child process cannot write outside the workspace or open the network
 * (when network is disabled).
 *
 * macOS: Seatbelt via sandbox-exec
 * Linux: bubblewrap when available (best-effort)
 * Other platforms: backend unavailable → app-layer only
 *
 * Paths used in Seatbelt `subpath` rules are canonicalized with
 * `fs.realpathSync` so macOS symlinks (`/var` → `/private/var`,
 * `/tmp` → `/private/tmp`) match the kernel-visible paths processes write to.
 */

import { spawnSync } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { Log } from "@/util/log"

const log = Log.create({ service: "isolation.os-sandbox" })

export namespace OsSandbox {
  export type Backend = "app" | "os" | "auto"

  export type Availability =
    | { available: true; platform: "darwin" | "linux"; mechanism: "seatbelt" | "bubblewrap" }
    | { available: false; platform: string; reason: string }

  export type WrapInput = {
    command: string
    shell: string
    cwd: string
    workspaceRoot: string
    worktree?: string
    network: boolean
    protectedPaths?: string[]
  }

  export type WrapResult =
    | {
        active: true
        mechanism: "seatbelt" | "bubblewrap"
        /** argv for spawn (first element is executable) */
        file: string
        args: string[]
        /** When true, caller should spawn with shell:false and use file/args */
        shell: false
        profilePath?: string
      }
    | {
        active: false
        reason: string
      }

  export function resolveBackend(input: {
    configBackend?: Backend
    envBackend?: string
  }): Backend {
    const env = input.envBackend?.trim().toLowerCase()
    if (env === "app" || env === "os" || env === "auto") return env
    if (input.configBackend === "app" || input.configBackend === "os" || input.configBackend === "auto") {
      return input.configBackend
    }
    return "app"
  }

  export function probeAvailability(platform: NodeJS.Platform = process.platform): Availability {
    if (platform === "darwin") {
      const sandboxExec = which("sandbox-exec")
      if (!sandboxExec) {
        return { available: false, platform, reason: "sandbox-exec not found on PATH" }
      }
      return { available: true, platform: "darwin", mechanism: "seatbelt" }
    }
    if (platform === "linux") {
      const bwrap = which("bwrap")
      if (!bwrap) {
        return {
          available: false,
          platform,
          reason: "bubblewrap (bwrap) not found; install bubblewrap for OS isolation",
        }
      }
      return { available: true, platform: "linux", mechanism: "bubblewrap" }
    }
    return {
      available: false,
      platform,
      reason: `OS isolation is not implemented for platform ${platform}`,
    }
  }

  function which(bin: string): string | undefined {
    const result = spawnSync("which", [bin], { encoding: "utf8" })
    if (result.status !== 0) return undefined
    const line = result.stdout.trim().split("\n")[0]
    return line || undefined
  }

  /**
   * Resolve a path for Seatbelt/bwrap rules.
   * Prefer realpath so symlink roots (macOS /var → /private/var) match kernel paths.
   * Falls back to path.resolve when the path does not exist yet.
   */
  export function canonicalPath(input: string): string {
    const resolved = path.resolve(input)
    try {
      return fs.realpathSync(resolved)
    } catch {
      // Path may not exist yet (protected dir on fresh checkout). Realpath the
      // longest existing prefix and rejoin the remainder.
      try {
        let current = resolved
        const suffix: string[] = []
        while (true) {
          try {
            const real = fs.realpathSync(current)
            return path.join(real, ...suffix.reverse())
          } catch {
            const parent = path.dirname(current)
            if (parent === current) return resolved
            suffix.push(path.basename(current))
            current = parent
          }
        }
      } catch {
        return resolved
      }
    }
  }

  /**
   * Build a Seatbelt (sandbox-exec) profile that:
   * - allows read of the whole filesystem (tools need system binaries)
   * - allows write only under workspace/worktree (+ temp dir for mktemp)
   * - denies network when network=false
   *
   * All write roots are canonicalized (realpath) so macOS symlink volumes match.
   */
  export function buildSeatbeltProfile(input: {
    workspaceRoot: string
    worktree?: string
    network: boolean
    protectedPaths?: string[]
  }): string {
    const roots = uniqueRoots(
      [input.workspaceRoot, input.worktree].filter(Boolean).map((p) => canonicalPath(p as string)),
    )
    const protectedPaths = (input.protectedPaths ?? []).map((p) => canonicalPath(p))
    const tmpRoots = uniqueRoots(tempWriteRoots())

    const writeAllow = [...roots, ...tmpRoots]
      .map((root) => `(allow file-write* (subpath ${sbString(root)}))`)
      .join("\n  ")

    // Deny writes into protected subpaths even if under workspace
    const writeDeny = protectedPaths
      .map((p) => `(deny file-write* (subpath ${sbString(p)}))`)
      .join("\n  ")

    const networkRule = input.network
      ? "(allow network*)"
      : "(deny network*)\n  (deny network-outbound)\n  (deny network-inbound)"

    return `(version 1)
(deny default)
(allow process*)
(allow sysctl-read)
(allow mach*)
(allow ipc*)
(allow signal)
(allow system-socket)
(allow file-read*)
(allow file-write-data (regex #"^/dev/null$"))
(allow file-write-data (regex #"^/dev/tty$"))
(allow file-ioctl (regex #"^/dev/"))
  ${writeAllow}
  ${writeDeny}
${networkRule}
`
  }

  /** Temp directories processes commonly use (mktemp, TMPDIR), realpath'd. */
  export function tempWriteRoots(): string[] {
    const candidates = [
      os.tmpdir(),
      process.env.TMPDIR,
      process.env.TMP,
      process.env.TEMP,
      "/tmp",
      "/var/tmp",
      "/private/tmp",
      "/private/var/tmp",
    ].filter((p): p is string => typeof p === "string" && p.length > 0)
    return uniqueRoots(candidates.map(canonicalPath))
  }

  function sbString(value: string): string {
    // Seatbelt subpath literals use double quotes with \" escape
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }

  function uniqueRoots(paths: string[]): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const p of paths) {
      const resolved = path.resolve(p)
      if (seen.has(resolved)) continue
      seen.add(resolved)
      out.push(resolved)
    }
    return out
  }

  export function wrapCommand(input: WrapInput): WrapResult {
    const availability = probeAvailability()
    if (!availability.available) {
      return { active: false, reason: availability.reason }
    }

    if (availability.mechanism === "seatbelt") {
      const profile = buildSeatbeltProfile({
        workspaceRoot: input.workspaceRoot,
        worktree: input.worktree,
        network: input.network,
        protectedPaths: input.protectedPaths,
      })
      // Write profile under realpath(tmpdir) so parent can always create it;
      // child only needs to read it (file-read* is allowed).
      const profileDir = canonicalPath(os.tmpdir())
      const profilePath = path.join(
        profileDir,
        `ax-code-seatbelt-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sb`,
      )
      try {
        fs.writeFileSync(profilePath, profile, { encoding: "utf8", mode: 0o600 })
      } catch (error) {
        log.warn("failed to write seatbelt profile", { error })
        return { active: false, reason: "failed to write seatbelt profile" }
      }
      const sandboxExec = which("sandbox-exec") ?? "sandbox-exec"
      // sandbox-exec -f profile.sh shell -c command
      return {
        active: true,
        mechanism: "seatbelt",
        file: sandboxExec,
        args: ["-f", profilePath, input.shell, "-c", input.command],
        shell: false,
        profilePath,
      }
    }

    // bubblewrap: unshare net when network disabled; bind workspace RW, rest RO
    const bwrap = which("bwrap") ?? "bwrap"
    const roots = uniqueRoots(
      [input.workspaceRoot, input.worktree, input.cwd].filter(Boolean).map((p) => canonicalPath(p as string)),
    )
    const args: string[] = [
      "--die-with-parent",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--ro-bind",
      "/",
      "/",
    ]
    for (const root of roots) {
      args.push("--bind", root, root)
    }
    if (!input.network) {
      args.push("--unshare-net")
    }
    args.push("--chdir", canonicalPath(input.cwd), input.shell, "-c", input.command)

    return {
      active: true,
      mechanism: "bubblewrap",
      file: bwrap,
      args,
      shell: false,
    }
  }

  /** Cleanup temporary seatbelt profiles. Best-effort. */
  export function cleanupProfile(profilePath: string | undefined) {
    if (!profilePath) return
    try {
      fs.unlinkSync(profilePath)
    } catch {
      // ignore
    }
  }
}
