import { describe, expect, test } from "bun:test"
import { keymapEvent, matchKeymapBinding, parseKeymapBindings, printKeymapBinding } from "../../../src/cli/cmd/tui/input/keymap"

describe("tui keymap", () => {
  test("parses named bindings and matches leader-aware events", () => {
    const keymap = parseKeymapBindings({
      leader: "ctrl+space",
      command_list: "<leader> p",
      input_clear: "ctrl+l",
    })

    expect(
      matchKeymapBinding(
        keymap,
        "command_list",
        {
          name: "p",
          ctrl: false,
          meta: false,
          shift: false,
        },
        true,
      ),
    ).toBe(true)

    expect(
      matchKeymapBinding(keymap, "input_clear", {
        name: "l",
        ctrl: true,
        meta: false,
        shift: false,
      }),
    ).toBe(true)

    expect(
      matchKeymapBinding(
        keymap,
        "command_list",
        {
          name: "p",
          ctrl: false,
          meta: false,
          shift: false,
        },
        false,
      ),
    ).toBe(false)
  })

  test("normalizes printable keys for downstream display", () => {
    const keymap = parseKeymapBindings({
      leader: "ctrl+space",
      command_list: "<leader> p",
    })

    expect(
      keymapEvent({
        name: " ",
        ctrl: false,
        meta: false,
        shift: false,
      }),
    ).toMatchObject({ name: "space" })

    expect(printKeymapBinding(keymap, "command_list")).toBe("ctrl+space p")
  })
})
