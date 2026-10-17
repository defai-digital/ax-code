import { afterEach, expect, test, vi } from "vitest"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

test("removal guard receives the entire live subtree and refuses before any deletion or event", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ title: "root" })
      const child = await Session.create({ title: "child", parentID: root.id })
      const grandchild = await Session.create({ title: "grandchild", parentID: child.id })
      const removed: string[] = []
      const off = Bus.subscribe(Session.Event.Deleted, ({ properties }) => {
        removed.push(properties.info.id)
      })
      const guard = vi.fn((subtree: readonly Session.RemovalSession[]) => {
        expect(new Set(subtree.map((session) => session.id))).toEqual(new Set([root.id, child.id, grandchild.id]))
        expect(subtree.every((session) => session.projectID === root.projectID)).toBe(true)
        return false
      })
      try {
        await expect(Session.remove(root.id, guard)).rejects.toBeInstanceOf(Session.RemovalGuardError)
        expect(guard).toHaveBeenCalledOnce()
        for (const session of [root, child, grandchild]) expect((await Session.get(session.id)).id).toBe(session.id)
        expect(removed).toEqual([])
      } finally {
        off()
      }
    },
  })
})

test("a throwing guard preserves the subtree and an allowing guard retains normal removal", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ title: "root" })
      const child = await Session.create({ title: "child", parentID: root.id })
      const stop = new Error("Guard unavailable")
      await expect(
        Session.remove(root.id, () => {
          throw stop
        }),
      ).rejects.toBe(stop)
      expect((await Session.get(child.id)).id).toBe(child.id)
      await Session.remove(root.id, (subtree) => subtree.length === 2)
      await expect(Session.get(root.id)).rejects.toThrow()
      await expect(Session.get(child.id)).rejects.toThrow()
    },
  })
})
