import { describe, expect, test } from "bun:test"
import { Command } from "../../src/command"

describe("Command.hints", () => {
  test("orders numbered placeholders numerically", () => {
    expect(Command.hints("run $1 then $10 then $2 then $2")).toEqual(["$1", "$2", "$10"])
  })

  test("keeps the catch-all arguments hint after numbered placeholders", () => {
    expect(Command.hints("$ARGUMENTS with $10 and $2")).toEqual(["$2", "$10", "$ARGUMENTS"])
  })
})
