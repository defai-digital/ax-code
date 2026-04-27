import { describe, expect, test } from "bun:test"
import { createBootstrapResponseTask, createBootstrapTask } from "../../../src/cli/cmd/tui/context/sync-bootstrap-task"

describe("tui sync bootstrap task", () => {
  test("normalizes arbitrary promise values before applying them", async () => {
    const applied: string[] = []

    await createBootstrapTask(
      () => Promise.resolve(["a", "b"]),
      (value) => value.join(","),
      (value) => {
        applied.push(value)
      },
    )()

    expect(applied).toEqual(["a,b"])
  })

  test("maps response data through the normalize step before applying", async () => {
    const applied: number[] = []

    await createBootstrapResponseTask(
      () => Promise.resolve({ data: [1, 2, 3] }),
      (value) => (value ?? []).length,
      (value) => {
        applied.push(value)
      },
    )()

    expect(applied).toEqual([3])
  })
})
