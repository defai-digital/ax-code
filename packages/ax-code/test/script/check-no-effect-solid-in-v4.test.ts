import { describe, expect, test } from "bun:test"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import { V4Guardrails, EffectGuard } from "../../script/check-no-effect-solid-in-v4"

describe("script.check-no-effect-solid-in-v4", () => {
  test("ignores safe imports and non-v4 directories", async () => {
    await using tmp = await tmpdir()
    await mkdir(path.join(tmp.path, "src/runtime"), { recursive: true })
    await mkdir(path.join(tmp.path, "src/cli/cmd/tui/state"), { recursive: true })
    await mkdir(path.join(tmp.path, "src/cli/cmd/tui"), { recursive: true })
    await writeFile(
      path.join(tmp.path, "src/runtime/safe.ts"),
      `import z from "zod"\nexport const value = z.string()\n`,
    )
    await writeFile(
      path.join(tmp.path, "src/cli/cmd/tui/state/safe.ts"),
      `import type { Stats } from "node:fs"\nexport const value = "ok"\n`,
    )
    await writeFile(path.join(tmp.path, "src/cli/cmd/tui/legacy.tsx"), `import { createSignal } from "solid-js"\n`)

    expect(await V4Guardrails.check(tmp.path)).toEqual([])
  })

  test("reports effect, solid, and opentui imports in guarded directories", async () => {
    await using tmp = await tmpdir()
    await mkdir(path.join(tmp.path, "src/cli/cmd/tui/input"), { recursive: true })
    await mkdir(path.join(tmp.path, "src/cli/cmd/tui/native"), { recursive: true })
    await mkdir(path.join(tmp.path, "src/runtime"), { recursive: true })
    await writeFile(path.join(tmp.path, "src/runtime/effect.ts"), `import { Effect } from "effect"\n`)
    await writeFile(path.join(tmp.path, "src/cli/cmd/tui/input/solid.ts"), `import { batch } from "solid-js"\n`)
    await writeFile(
      path.join(tmp.path, "src/cli/cmd/tui/native/opentui.ts"),
      `import { render } from "@opentui/core"\n`,
    )

    expect((await V4Guardrails.check(tmp.path)).map((item) => V4Guardrails.format(item))).toEqual([
      "src/cli/cmd/tui/input/solid.ts imports solid-js (solid)",
      "src/cli/cmd/tui/native/opentui.ts imports @opentui/core (opentui)",
      "src/runtime/effect.ts imports effect (effect)",
    ])
  })
})

describe("script.check-no-effect-solid-in-v4 EffectGuard", () => {
  test("flags effect imports outside allowed dirs", async () => {
    await using tmp = await tmpdir()
    await mkdir(path.join(tmp.path, "src/account"), { recursive: true })
    await writeFile(path.join(tmp.path, "src/account/new.ts"), `import { Effect } from "effect"\n`)
    const violations = await EffectGuard.check(tmp.path)
    expect(violations).toEqual([{ file: "src/account/new.ts", spec: "effect" }])
  })

  test("flags effect imports inside former runtime infrastructure and bridge file", async () => {
    await using tmp = await tmpdir()
    await mkdir(path.join(tmp.path, "src/effect"), { recursive: true })
    await mkdir(path.join(tmp.path, "src/util"), { recursive: true })
    await writeFile(path.join(tmp.path, "src/effect/ok.ts"), `import { Effect } from "effect"\n`)
    await writeFile(path.join(tmp.path, "src/util/effect-zod.ts"), `import { Schema } from "effect"\n`)
    expect(await EffectGuard.check(tmp.path)).toEqual([
      { file: "src/effect/ok.ts", spec: "effect" },
      { file: "src/util/effect-zod.ts", spec: "effect" },
    ])
  })

  test("flags new session and file watcher effect imports", async () => {
    await using tmp = await tmpdir()
    await mkdir(path.join(tmp.path, "src/session"), { recursive: true })
    await mkdir(path.join(tmp.path, "src/file"), { recursive: true })
    await writeFile(path.join(tmp.path, "src/session/new.ts"), `import { Schema } from "effect"\n`)
    await writeFile(path.join(tmp.path, "src/file/watcher.ts"), `import { Effect } from "effect"\n`)
    expect(await EffectGuard.check(tmp.path)).toEqual([
      { file: "src/file/watcher.ts", spec: "effect" },
      { file: "src/session/new.ts", spec: "effect" },
    ])
  })

  test("has no remaining grandfathered Effect importers", async () => {
    expect(EffectGuard.ExistingViolations.size).toBe(0)
  })
})
