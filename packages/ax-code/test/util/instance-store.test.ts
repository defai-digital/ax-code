import { expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { InstanceStore } from "../../src/util/instance-store"
import { tmpdir } from "../fixture/fixture"

test("InstanceStore dispose clears state and rejects future use", async () => {
  let n = 0
  const store = InstanceStore.create(async () => {
    n += 1
    return { id: n }
  })

  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(store.has()).toBe(false)
      expect((await store.get()).id).toBe(1)
      expect(store.has()).toBe(true)

      store.dispose()

      expect(store.has()).toBe(false)
      expect(store.get()).rejects.toThrow("instance store disposed")
    },
  })
})
