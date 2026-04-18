import { describe, expect, test } from "bun:test"
import path from "node:path"
import { writeFile } from "node:fs/promises"
import {
  isNativeTuiRendererPromotedDefault,
  resolveTuiRendererManifestPath,
  resolveTuiRendererName,
} from "../../../src/cli/cmd/tui/renderer-choice"
import { tmpdir } from "../../fixture/fixture"

describe("tui renderer choice", () => {
  test("keeps OpenTUI as the default without a ready promotion manifest", async () => {
    await using tmp = await tmpdir()
    const manifestPath = path.join(tmp.path, "tui-renderer-phase5-manifest.json")

    expect(resolveTuiRendererManifestPath(manifestPath)).toBe(manifestPath)
    expect(isNativeTuiRendererPromotedDefault(manifestPath)).toBe(false)
    expect(resolveTuiRendererName(undefined, { manifestPath })).toBe("opentui")
  })

  test("promotes native by default only when the phase5 manifest is ready and fallback is retained", async () => {
    await using tmp = await tmpdir()
    const manifestPath = path.join(tmp.path, "tui-renderer-phase5-manifest.json")
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          renderer: "native",
          opentuiFallbackRetained: true,
          decision: {
            ready: true,
            action: "promote-native-default",
          },
        },
        null,
        2,
      ) + "\n",
    )

    expect(isNativeTuiRendererPromotedDefault(manifestPath)).toBe(true)
    expect(resolveTuiRendererName(undefined, { manifestPath })).toBe("native")
    expect(resolveTuiRendererName("native", { manifestPath, nativeEnabled: "0" })).toBe("native")
    expect(resolveTuiRendererName("opentui", { manifestPath })).toBe("opentui")
  })

  test("fails closed on malformed or incomplete manifests", async () => {
    await using tmp = await tmpdir()
    const manifestPath = path.join(tmp.path, "tui-renderer-phase5-manifest.json")
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          renderer: "native",
          opentuiFallbackRetained: false,
          decision: {
            ready: true,
            action: "promote-native-default",
          },
        },
        null,
        2,
      ) + "\n",
    )

    expect(isNativeTuiRendererPromotedDefault(manifestPath)).toBe(false)
    expect(resolveTuiRendererName(undefined, { manifestPath })).toBe("opentui")

    await writeFile(manifestPath, "{not-json}\n")
    expect(isNativeTuiRendererPromotedDefault(manifestPath)).toBe(false)
    expect(resolveTuiRendererName(undefined, { manifestPath })).toBe("opentui")
  })
})
