import { afterEach, expect, test } from "vitest"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../../fixture/fixture"
import { Instance } from "../../../src/project/instance"
import { TuiConfig } from "../../../src/config/tui"
import { Global } from "../../../src/global"
import { Filesystem } from "../../../src/util/filesystem"

// Regression coverage for section 11: a single unknown/typo'd keybind key (or a
// non-string value) used to make the strict schema reject the ENTIRE tui.json,
// silently reverting the user's theme and every other keybind to defaults. The
// auto-migration also wrote exactly such unvalidated files. Fixes: salvage the
// individually-valid fields on load, and filter keybinds during migration.

const managedConfigDir = process.env.AX_CODE_TEST_MANAGED_CONFIG_DIR!

afterEach(async () => {
  delete process.env.AX_CODE_CONFIG
  delete process.env.AX_CODE_TUI_CONFIG
  await fs.rm(path.join(Global.Path.config, "tui.json"), { force: true }).catch(() => {})
  await fs.rm(path.join(Global.Path.config, "tui.jsonc"), { force: true }).catch(() => {})
  await fs.rm(managedConfigDir, { force: true, recursive: true }).catch(() => {})
})

test("salvages theme and valid keybinds when an unknown keybind key is present", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.writeFile(
        path.join(dir, "tui.json"),
        JSON.stringify({
          theme: "salvaged-theme",
          diff_style: "stacked",
          keybinds: {
            app_exit: "ctrl+q",
            // unknown/typo'd key -> strict validation of the whole file fails
            bogus_key: "ctrl+z",
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      // Previously all three would have reverted to defaults.
      expect(config.theme).toBe("salvaged-theme")
      expect(config.diff_style).toBe("stacked")
      expect(config.keybinds?.app_exit).toBe("ctrl+q")
      expect((config.keybinds as Record<string, unknown>).bogus_key).toBeUndefined()
    },
  })
})

test("salvages valid fields when a non-string keybind value is present", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.writeFile(
        path.join(dir, "tui.json"),
        JSON.stringify({
          theme: "salvaged-theme",
          keybinds: {
            app_exit: "ctrl+q",
            // non-string value fails strict string validation
            theme_list: 5,
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("salvaged-theme")
      expect(config.keybinds?.app_exit).toBe("ctrl+q")
      // invalid override dropped -> falls back to schema default
      expect(config.keybinds?.theme_list).toBe("<leader>t")
    },
  })
})

test("salvages theme when an unknown top-level key is present", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.writeFile(
        path.join(dir, "tui.json"),
        JSON.stringify({
          theme: "salvaged-theme",
          not_a_real_option: 123,
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("salvaged-theme")
    },
  })
})

test("migration filters unknown and non-string keybinds before writing tui.json", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await fs.writeFile(
        path.join(dir, "ax-code.json"),
        JSON.stringify(
          {
            theme: "migrated-theme",
            keybinds: {
              app_exit: "ctrl+q",
              // legacy/opencode-era or typo'd key
              legacy_key: "ctrl+z",
              // non-string value
              theme_list: 5,
            },
          },
          null,
          2,
        ),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await TuiConfig.get()
      expect(config.theme).toBe("migrated-theme")
      expect(config.keybinds?.app_exit).toBe("ctrl+q")

      // The written tui.json must only contain valid known string keybinds so it
      // loads cleanly instead of being rejected as a whole.
      const migrated = JSON.parse(await Filesystem.readText(path.join(tmp.path, "tui.json")))
      expect(migrated.keybinds).toEqual({ app_exit: "ctrl+q" })
      expect(migrated.keybinds.legacy_key).toBeUndefined()
      expect(migrated.keybinds.theme_list).toBeUndefined()
    },
  })
})
