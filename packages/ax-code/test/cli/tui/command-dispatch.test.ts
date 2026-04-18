import { describe, expect, test } from "bun:test"
import { resolveCommandKeyDispatch } from "../../../src/cli/cmd/tui/input/command-dispatch"
import { parseKeymapBindings } from "../../../src/cli/cmd/tui/input/keymap"

const keymap = parseKeymapBindings({
  command_list: "ctrl+k",
  session_interrupt: "ctrl+c",
  input_submit: "meta+return",
})

describe("tui command dispatch", () => {
  test("opens the command palette only when the current owner allows command dispatch", () => {
    expect(
      resolveCommandKeyDispatch({
        owner: { type: "app" },
        event: {
          name: "k",
          ctrl: true,
          meta: false,
          shift: false,
        },
        keymap,
        entries: [],
      }),
    ).toEqual({
      type: "palette",
      owner: "app",
    })

    expect(
      resolveCommandKeyDispatch({
        owner: { type: "permission", sessionID: "ses_1" },
        event: {
          name: "k",
          ctrl: true,
          meta: false,
          shift: false,
        },
        keymap,
        entries: [],
      }),
    ).toEqual({
      type: "ignored",
      owner: "permission",
      reason: "permission owns input",
    })
  })

  test("dispatches matching commands for allowed owners and skips owner-mismatched entries", () => {
    const entries = [
      {
        value: "session.interrupt",
        keybind: "session_interrupt",
      },
      {
        value: "prompt.submit",
        keybind: "input_submit",
        owners: ["prompt"] as const,
      },
    ]

    expect(
      resolveCommandKeyDispatch({
        owner: { type: "prompt" },
        event: {
          name: "return",
          ctrl: false,
          meta: true,
          shift: false,
        },
        keymap,
        entries,
      }),
    ).toEqual({
      type: "command",
      owner: "prompt",
      value: "prompt.submit",
    })

    expect(
      resolveCommandKeyDispatch({
        owner: { type: "app" },
        event: {
          name: "return",
          ctrl: false,
          meta: true,
          shift: false,
        },
        keymap,
        entries,
      }),
    ).toEqual({
      type: "ignored",
      owner: "app",
      reason: "no matching command",
    })
  })
})
