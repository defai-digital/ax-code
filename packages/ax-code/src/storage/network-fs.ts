import { execFileSync } from "node:child_process"
import { statfsSync } from "node:fs"
import path from "node:path"

// ADR-210: WAL relies on a shared-memory `-shm` file that is unsafe over NFS
// and SMB (corruption, SIGBUS across hosts). These probes decide whether a
// database sits on a network filesystem so the SQLite journal mode can fall
// back to a rollback journal. Detection failure always answers "not network",
// which keeps WAL — never the other way round.

export type NetworkFilesystemDeps = {
  platform?: NodeJS.Platform
  statfs?: (target: string) => { type: number }
  readMountTable?: () => string
}

// Linux statfs f_type magic numbers of network filesystems. FUSE
// (0x65735546) is deliberately excluded: it is local from SQLite's point of
// view and its shares behave like local disks.
const LINUX_NETWORK_FS_MAGIC = new Set<number>([
  0x6969, // NFS_SUPER_MAGIC
  0x517b, // SMB_SUPER_MAGIC
  0xff534d42, // CIFS_MAGIC_NUMBER
  0xfe534d42, // SMB2_MAGIC_NUMBER
  0x5346414f, // AFS_FS_MAGIC
  0x00c36400, // CEPH_SUPER_MAGIC
])

// macOS `mount` filesystem types that are network filesystems.
const DARWIN_NETWORK_FS_TYPES = new Set(["nfs", "nfsd", "smbfs", "afpfs", "cifs", "webdav"])

// autofs triggers mounts for local and remote targets alike; treating it as
// network would false-positive on stock laptops (auto_home on /home).
const DARWIN_AUTOMOUNT_TYPES = new Set(["autofs", "nullfs"])

// The `mount` probe is an external process; never let it hang a startup.
const MOUNT_TIMEOUT_MS = 2_000
// Ancestor-walk guard for deeply nested paths (and pathological loops).
const STATFS_MAX_ANCESTORS = 64

/**
 * Pure platform-aware network filesystem detection. Every probe is
 * injectable so tests never touch the real mount table, and every failure
 * mode (ENOENT, EPERM, timeout, unparseable output) reports `false`.
 */
export function isNetworkFilesystem(target: string, deps: NetworkFilesystemDeps = {}): boolean {
  const platform = deps.platform ?? process.platform
  try {
    if (platform === "win32") return isUncPath(target)
    if (platform === "linux") return isNetworkLinux(target, deps)
    if (platform === "darwin") return isNetworkDarwin(target, deps)
    return false
  } catch {
    return false
  }
}

function isNetworkLinux(target: string, deps: NetworkFilesystemDeps): boolean {
  const statfs = deps.statfs ?? ((probe: string) => statfsSync(probe))
  // The deepest existing ancestor decides: a fresh install has no database
  // file yet, and the answer for its directory is the answer for the file.
  let current = path.resolve(target)
  for (let depth = 0; depth < STATFS_MAX_ANCESTORS; depth++) {
    try {
      return LINUX_NETWORK_FS_MAGIC.has(statfs(current).type)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return false
      current = parent
    }
  }
  return false
}

function isNetworkDarwin(target: string, deps: NetworkFilesystemDeps): boolean {
  const readMountTable = deps.readMountTable ?? readMountTableDefault
  const entries = parseDarwinMounts(readMountTable())
  const resolved = path.resolve(target)
  // Longest matching mount point wins (a nested smbfs mount under a local
  // volume must not be answered by the local `/` entry).
  let match: { mountPoint: string; network: boolean } | undefined
  for (const entry of entries) {
    if (!isMountPointPrefix(resolved, entry.mountPoint)) continue
    if (!match || entry.mountPoint.length > match.mountPoint.length) match = entry
  }
  return match?.network ?? false
}

function readMountTableDefault(): string {
  return execFileSync("mount", {
    encoding: "utf8",
    timeout: MOUNT_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "ignore"],
  })
}

// `mount` lines look like `/dev/disk1s1 on / (apfs, local, journaled)` and
// `//user@server/share on /Volumes/share (smbfs, noowners, nosuid)`. The
// filesystem type is the first parenthesised option; local mounts carry the
// `local` flag. Node's statfs does not expose macOS MNT_LOCAL, so the mount
// table is the only pure-Node source.
function parseDarwinMounts(output: string): { mountPoint: string; network: boolean }[] {
  const entries: { mountPoint: string; network: boolean }[] = []
  for (const line of output.split("\n")) {
    const match = /^(.+?) on (.+?) \((.+)\)\s*$/.exec(line)
    if (!match) continue
    const options = match[3].split(",").map((option) => option.trim())
    const fsType = (options.shift() ?? "").toLowerCase()
    const network =
      DARWIN_NETWORK_FS_TYPES.has(fsType) || (!options.includes("local") && !DARWIN_AUTOMOUNT_TYPES.has(fsType))
    entries.push({ mountPoint: match[2], network })
  }
  return entries
}

function isMountPointPrefix(target: string, mountPoint: string): boolean {
  if (mountPoint === "/") return true
  return target === mountPoint || target.startsWith(mountPoint + "/")
}

// UNC paths (\\server\share) are network. Mapped drives are left alone:
// resolving them needs `net use`, which is not a pure path check.
function isUncPath(target: string): boolean {
  const normalized = target.replace(/\//g, "\\")
  if (normalized.startsWith("\\\\?\\UNC\\")) return true
  // Other \\?\ forms are local: a drive-letter or Volume-GUID long path is
  // on the same disk as its bare spelling, and \\.\ is the device namespace.
  if (normalized.startsWith("\\\\?\\")) return false
  if (!normalized.startsWith("\\\\")) return false
  const rest = normalized.slice(2)
  if (rest.startsWith(".")) return false // \\.\ device namespace is local
  const server = rest.split("\\", 1)[0] ?? ""
  return server.length > 0
}
