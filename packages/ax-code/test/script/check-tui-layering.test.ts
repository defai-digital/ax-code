import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import { TuiLayeringGuardrails } from "../../script/check-tui-layering"

describe("script.check-tui-layering", () => {
  test("ignores safe imports and files outside the protected TUI logic layer", async () => {
    await using tmp = await tmpdir()
    await mkdir(path.join(tmp.path, "src/cli/cmd/tui/routes/session"), { recursive: true })
    await mkdir(path.join(tmp.path, "src/cli/cmd/tui/ui"), { recursive: true })
    await writeFile(
      path.join(tmp.path, "src/cli/cmd/tui/routes/session/view-model.ts"),
      `import { Locale } from "@/util/locale"\nexport const value = Locale.titlecase("safe")\n`,
    )
    await writeFile(
      path.join(tmp.path, "src/cli/cmd/tui/ui/dialog.tsx"),
      `import { useRenderer } from "@opentui/solid"\nexport const value = useRenderer\n`,
    )

    expect(await TuiLayeringGuardrails.check(tmp.path)).toEqual([])
  })

  test("reports renderer and solid imports in protected pure TUI files", async () => {
    await using tmp = await tmpdir()
    await mkdir(path.join(tmp.path, "src/cli/cmd/tui/routes/session"), { recursive: true })
    await mkdir(path.join(tmp.path, "src/cli/cmd/tui/util"), { recursive: true })
    await writeFile(
      path.join(tmp.path, "src/cli/cmd/tui/routes/session/view-model.ts"),
      `import { createMemo } from "solid-js"\nexport const value = createMemo\n`,
    )
    await writeFile(
      path.join(tmp.path, "src/cli/cmd/tui/util/microtask.ts"),
      `import { render } from "@opentui/solid"\nexport const value = render\n`,
    )

    expect((await TuiLayeringGuardrails.check(tmp.path)).map((item) => TuiLayeringGuardrails.format(item))).toEqual([
      "src/cli/cmd/tui/routes/session/view-model.ts imports solid-js (solid)",
      "src/cli/cmd/tui/util/microtask.ts imports @opentui/solid (renderer)",
    ])
  })

  test("keeps protected TUI logic files free of solid and renderer imports in the current repo", async () => {
    const root = path.resolve(import.meta.dir, "../..")

    expect(await TuiLayeringGuardrails.check(root)).toEqual([])
  })
})
