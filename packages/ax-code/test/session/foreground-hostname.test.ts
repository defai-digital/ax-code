import { hostname } from "node:os"
import fs from "node:fs"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { ForegroundOwnership } from "../../src/session/foreground-ownership"
import { tmpdir } from "../fixture/fixture"

vi.mock("node:os", async (original) => {
  const actual = await original<typeof import("node:os")>()
  return { ...actual, hostname: vi.fn(actual.hostname) }
})
afterEach(() => vi.mocked(hostname).mockReset())

test("hostname changes during a held generation cannot reject clean terminal release", async () => {
  await using tmp = await tmpdir()
  const db = path.join(tmp.path, "registry.db")
  vi.mocked(hostname).mockReturnValue("original-host")
  const lease = ForegroundOwnership.acquire(db, "session")
  lease.begin()
  vi.mocked(hostname).mockReturnValue("renamed-host")
  expect(() => lease.release(true)).not.toThrow()
  expect(fs.existsSync(ForegroundOwnership.paths(db, "session").journal)).toBe(false)
})

test("hostname mismatch on later acquisition still requires explicit operator recovery", async () => {
  await using tmp = await tmpdir()
  const db = path.join(tmp.path, "registry.db")
  vi.mocked(hostname).mockReturnValue("original-host")
  const lease = ForegroundOwnership.acquire(db, "session")
  lease.begin()
  lease.release(false)
  const journal = ForegroundOwnership.paths(db, "session").journal
  const original = fs.readFileSync(journal, "utf8")
  vi.mocked(hostname).mockReturnValue("different-host")
  expect(() => ForegroundOwnership.acquire(db, "session")).toThrow(ForegroundOwnership.OwnershipError)
  expect(fs.readFileSync(journal, "utf8")).toBe(original)
})
