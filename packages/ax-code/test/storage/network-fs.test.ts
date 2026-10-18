import { describe, expect, test } from "vitest"
import { isNetworkFilesystem } from "../../src/storage/network-fs"
import {
  describeDurableStoragePolicy,
  resolveSqliteJournalMode,
  resolveSqliteSynchronous,
} from "../../src/storage/policy"

// Linux statfs magic numbers (see network-fs.ts for the full set).
const NFS = 0x6969
const SMB = 0x517b
const CIFS = 0xff534d42
const SMB2 = 0xfe534d42
const AFS = 0x5346414f
const CEPH = 0x00c36400
const FUSE = 0x65735546
const EXT4 = 0xef53

function statfsByPath(table: Record<string, number>) {
  return (target: string) => {
    const type = table[target]
    if (type === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    return { type }
  }
}

describe("isNetworkFilesystem (linux)", () => {
  test.each([
    ["nfs", NFS],
    ["smb", SMB],
    ["cifs", CIFS],
    ["smb2", SMB2],
    ["afs", AFS],
    ["ceph", CEPH],
  ])("reports %s mounts as network", (_label, magic) => {
    expect(
      isNetworkFilesystem("/home/enterprise/ax-code/ax-code.db", {
        platform: "linux",
        statfs: statfsByPath({ "/home/enterprise/ax-code/ax-code.db": magic }),
      }),
    ).toBe(true)
  })

  test("reports local and FUSE mounts as not network", () => {
    for (const magic of [EXT4, FUSE]) {
      expect(
        isNetworkFilesystem("/home/user/ax-code/ax-code.db", {
          platform: "linux",
          statfs: statfsByPath({ "/home/user/ax-code/ax-code.db": magic }),
        }),
      ).toBe(false)
    }
  })

  test("walks up to the deepest existing ancestor for a fresh database file", () => {
    expect(
      isNetworkFilesystem("/mnt/nfs/ax-code/ax-code.db", {
        platform: "linux",
        statfs: statfsByPath({ "/mnt/nfs": NFS }),
      }),
    ).toBe(true)
    expect(
      isNetworkFilesystem("/mnt/local/ax-code/ax-code.db", {
        platform: "linux",
        statfs: statfsByPath({ "/mnt/local": EXT4 }),
      }),
    ).toBe(false)
  })

  test("detection failure (every probe throws) keeps the local answer", () => {
    expect(
      isNetworkFilesystem("/mnt/whatever/ax-code.db", {
        platform: "linux",
        statfs: () => {
          throw new Error("EPERM")
        },
      }),
    ).toBe(false)
  })
})

const DARWIN_LOCAL_ROOT = `/dev/disk1s1 on / (apfs, local, journaled)`
const DARWIN_SMB = `//user@fileserver/share on /Volumes/share (smbfs, nodev, noowners, nosuid, mounted by user)`
const DARWIN_NFS = `fileserver:/export on /mnt/nfs (nfs, nodev, nosuid, mounted by user)`
const DARWIN_AUTOFS = `map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)`

describe("isNetworkFilesystem (darwin)", () => {
  test("reports paths under an smbfs mount as network", () => {
    expect(
      isNetworkFilesystem("/Volumes/share/ax-code/ax-code.db", {
        platform: "darwin",
        readMountTable: () => [DARWIN_LOCAL_ROOT, DARWIN_SMB].join("\n"),
      }),
    ).toBe(true)
  })

  test("reports paths under an nfs mount as network", () => {
    expect(
      isNetworkFilesystem("/mnt/nfs/data/ax-code.db", {
        platform: "darwin",
        readMountTable: () => [DARWIN_LOCAL_ROOT, DARWIN_NFS].join("\n"),
      }),
    ).toBe(true)
  })

  test("prefers the longest matching mount point", () => {
    // The local root `/` also matches; the nested smbfs entry must win.
    const table = [DARWIN_LOCAL_ROOT, DARWIN_SMB].join("\n")
    expect(
      isNetworkFilesystem("/Volumes/share/sub/ax-code.db", { platform: "darwin", readMountTable: () => table }),
    ).toBe(true)
    expect(
      isNetworkFilesystem("/Users/me/ax-code/ax-code.db", { platform: "darwin", readMountTable: () => table }),
    ).toBe(false)
  })

  test("does not treat a sibling directory with a longer name as a match", () => {
    expect(
      isNetworkFilesystem("/Volumes/share2/ax-code.db", {
        platform: "darwin",
        readMountTable: () => [DARWIN_LOCAL_ROOT, DARWIN_SMB].join("\n"),
      }),
    ).toBe(false)
  })

  test("local mounts and autofs triggers are not network", () => {
    expect(
      isNetworkFilesystem("/System/Volumes/Data/home/me/ax-code.db", {
        platform: "darwin",
        readMountTable: () => [DARWIN_LOCAL_ROOT, DARWIN_AUTOFS].join("\n"),
      }),
    ).toBe(false)
  })

  test("unparseable output or a failing mount probe is not network", () => {
    expect(
      isNetworkFilesystem("/Volumes/share/ax-code.db", {
        platform: "darwin",
        readMountTable: () => "complete garbage with no mount lines",
      }),
    ).toBe(false)
    expect(
      isNetworkFilesystem("/Volumes/share/ax-code.db", {
        platform: "darwin",
        readMountTable: () => {
          throw new Error("spawn mount ETIMEDOUT")
        },
      }),
    ).toBe(false)
  })
})

describe("isNetworkFilesystem (win32)", () => {
  test("reports UNC paths as network", () => {
    expect(isNetworkFilesystem("\\\\fileserver\\share\\ax-code\\ax-code.db", { platform: "win32" })).toBe(true)
    expect(isNetworkFilesystem("//fileserver/share/ax-code/ax-code.db", { platform: "win32" })).toBe(true)
    expect(isNetworkFilesystem("\\\\?\\UNC\\fileserver\\share\\ax-code.db", { platform: "win32" })).toBe(true)
  })

  test("reports local paths as not network", () => {
    expect(isNetworkFilesystem("C:\\Users\\me\\ax-code\\ax-code.db", { platform: "win32" })).toBe(false)
    expect(isNetworkFilesystem("\\\\.\\PhysicalDrive0", { platform: "win32" })).toBe(false)
    // Long-path and Volume-GUID spellings of local disks are still local;
    // only the \\?\UNC\ form of the prefix is a network share.
    expect(isNetworkFilesystem("\\\\?\\C:\\Users\\me\\ax-code\\ax-code.db", { platform: "win32" })).toBe(false)
    expect(
      isNetworkFilesystem("\\\\?\\Volume{12345678-0000-0000-0000-000000000000}\\ax-code\\ax-code.db", {
        platform: "win32",
      }),
    ).toBe(false)
  })
})

describe("resolveSqliteJournalMode", () => {
  test("defaults to WAL without a path", () => {
    expect(resolveSqliteJournalMode({ env: {} })).toBe("WAL")
  })

  test("selects DELETE on a network filesystem", () => {
    expect(resolveSqliteJournalMode({ path: "/mnt/nfs/ax-code.db", env: {}, isNetworkFilesystem: () => true })).toBe(
      "DELETE",
    )
  })

  test("keeps WAL on a local filesystem and on detection failure", () => {
    expect(resolveSqliteJournalMode({ path: "/tmp/ax-code.db", env: {}, isNetworkFilesystem: () => false })).toBe("WAL")
    expect(
      resolveSqliteJournalMode({
        path: "/tmp/ax-code.db",
        env: {},
        isNetworkFilesystem: () => {
          throw new Error("EPERM")
        },
      }),
    ).toBe("WAL")
  })

  test("AX_CODE_SQLITE_JOURNAL overrides detection in both directions", () => {
    expect(
      resolveSqliteJournalMode({
        path: "/tmp/ax-code.db",
        env: { AX_CODE_SQLITE_JOURNAL: "wal" },
        isNetworkFilesystem: () => true,
      }),
    ).toBe("WAL")
    expect(
      resolveSqliteJournalMode({
        path: "/tmp/ax-code.db",
        env: { AX_CODE_SQLITE_JOURNAL: " truncate " },
        isNetworkFilesystem: () => true,
      }),
    ).toBe("TRUNCATE")
    expect(resolveSqliteJournalMode({ env: { AX_CODE_SQLITE_JOURNAL: "delete" } })).toBe("DELETE")
  })

  test("an unrecognized override value is ignored", () => {
    expect(
      resolveSqliteJournalMode({
        path: "/mnt/nfs/ax-code.db",
        env: { AX_CODE_SQLITE_JOURNAL: "banana" },
        isNetworkFilesystem: () => true,
      }),
    ).toBe("DELETE")
    expect(resolveSqliteJournalMode({ env: { AX_CODE_SQLITE_JOURNAL: "banana" } })).toBe("WAL")
  })
})

describe("resolveSqliteSynchronous", () => {
  test("NORMAL in WAL, FULL in rollback-journal modes", () => {
    // NORMAL's no-corruption guarantee on power loss is WAL-only; in DELETE
    // or TRUNCATE an unsynced journal page can corrupt the database.
    expect(resolveSqliteSynchronous("WAL")).toBe("NORMAL")
    expect(resolveSqliteSynchronous("DELETE")).toBe("FULL")
    expect(resolveSqliteSynchronous("TRUNCATE")).toBe("FULL")
  })
})

describe("describeDurableStoragePolicy", () => {
  test("reports the resolved journal mode when given one", () => {
    expect(describeDurableStoragePolicy({ journalMode: "DELETE" })).toContain("journal DELETE")
    expect(describeDurableStoragePolicy()).toContain("journal WAL")
  })
})
