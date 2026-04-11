import { describe, expect, test } from "bun:test"
import { AutoSelect } from "../../src/cli/cmd/auto-select"

describe("auto select helpers", () => {
  test("detects apply mode from prompt or command input", () => {
    expect(AutoSelect.apply({})).toBe(false)
    expect(AutoSelect.apply({ message: [] })).toBe(false)
    expect(AutoSelect.apply({ message: ["fix it"] })).toBe(true)
    expect(AutoSelect.apply({ command: "npm test" })).toBe(true)
  })

  test("builds run args pinned to the recommended session", () => {
    const args = AutoSelect.runArgs({
      sessionID: "ses_best",
      message: ["fix", "this"],
      model: "openai/gpt-5",
      agent: "build",
      format: "json",
      thinking: true,
      file: ["README.md"],
    })

    expect(args.session).toBe("ses_best")
    expect(args.message).toEqual(["fix", "this"])
    expect(args.continue).toBe(false)
    expect(args.fork).toBe(false)
    expect(args.format).toBe("json")
    expect(args.file).toEqual(["README.md"])
    expect(args.model).toBe("openai/gpt-5")
    expect(args.agent).toBe("build")
    expect(args.thinking).toBe(true)
  })

  test("forwards apply mode to the run handler", async () => {
    let seen: ReturnType<typeof AutoSelect.runArgs> | undefined

    await AutoSelect.handoff(
      {
        sessionID: "ses_best",
        message: ["ship it"],
        command: undefined,
      },
      {
        run: async (args) => {
          seen = args
        },
      },
    )

    expect(seen?.session).toBe("ses_best")
    expect(seen?.message).toEqual(["ship it"])
  })
})
