import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { sidebarVersionLabel } from "../../../src/cli/tui/routes/session/sidebar"

// Source-pattern guards for the theme-token chrome pass (matching the
// render-anti-patterns.test.ts approach): colors flow through ax-tui
// renderables, so the token wiring is asserted on the component sources
// while the derivable logic (version label) is unit-tested directly.

const TUI_ROOT = path.join(import.meta.dirname, "../../../src/cli/tui")
const read = (relative: string) => fs.readFile(path.join(TUI_ROOT, relative), "utf8")

describe("chrome control color follows the theme", () => {
  test("the hard-coded chrome purple constant is gone", async () => {
    const chromeAction = await read("component/chrome-action.tsx")
    expect(chromeAction).not.toContain("CHROME_CONTROL_COLOR")
    expect(chromeAction).not.toContain("#a78bfa")
  })

  test("navigation bar, rail, header and sidebar use theme.secondary", async () => {
    for (const relative of [
      "component/navigation-bar.tsx",
      "component/session-navigation.tsx",
      "routes/session/header.tsx",
      "routes/session/sidebar.tsx",
    ]) {
      const source = await read(relative)
      expect(source, relative).not.toContain("CHROME_CONTROL_COLOR")
      expect(source, relative).toContain("theme.secondary")
    }
  })
})

describe("chrome surfaces use themed panel backgrounds", () => {
  test("the sidebar path strip and the rail options row drop their black fill", async () => {
    const sidebar = await read("routes/session/sidebar.tsx")
    const navigation = await read("component/session-navigation.tsx")
    for (const source of [sidebar, navigation]) {
      expect(source).not.toContain('RGBA.fromHex("#000000")')
    }
    expect(sidebar).not.toContain("PATH_BACKGROUND")
    expect(sidebar).toContain("bg: theme.backgroundPanel")
    expect(navigation).not.toContain("OPTIONS_BACKGROUND")
    expect(navigation).toContain("bg: theme.backgroundPanel")
  })
})

describe("sidebarVersionLabel", () => {
  test("prefixes semver releases with v", () => {
    expect(sidebarVersionLabel("7.25.5")).toBe("v7.25.5")
    expect(sidebarVersionLabel("0.0.1-beta.1")).toBe("v0.0.1-beta.1")
  })

  test("does not prefix non-semver versions like local", () => {
    expect(sidebarVersionLabel("local")).toBe("local")
    expect(sidebarVersionLabel("dev")).toBe("dev")
    expect(sidebarVersionLabel("7.25")).toBe("7.25")
  })

  test("normalizes an already-prefixed semver instead of doubling the v", () => {
    expect(sidebarVersionLabel("v7.25.5")).toBe("v7.25.5")
  })

  test("the sidebar footer renders the label instead of a raw v + version", async () => {
    const sidebar = await read("routes/session/sidebar.tsx")
    expect(sidebar).toContain("sidebarVersionLabel(Installation.VERSION)")
    expect(sidebar).not.toContain("<span>v{Installation.VERSION}</span>")
  })
})

describe("file-edit diff panels blend into the BlockTool surface", () => {
  test("context lines and line-number gutters use the panel background", async () => {
    const fileEdits = await read("routes/session/tool-renderers/file-edits.tsx")
    expect(fileEdits.match(/contextBg: theme\.backgroundPanel/g)).toHaveLength(2)
    expect(fileEdits.match(/lineNumberBg: theme\.backgroundPanel/g)).toHaveLength(2)
    expect(fileEdits).not.toContain("contextBg: theme.diffContextBg")
    expect(fileEdits).not.toContain("lineNumberBg: theme.diffContextBg")
  })

  test("summary counts use the diff palette, not success/error", async () => {
    const fileEdits = await read("routes/session/tool-renderers/file-edits.tsx")
    expect(fileEdits.match(/fg: theme\.diffAdded \}\}>\+\{s\(\)\.added\}/g)).toHaveLength(2)
    expect(fileEdits.match(/fg: theme\.diffRemoved \}\}>−\{s\(\)\.removed\}/g)).toHaveLength(2)
    expect(fileEdits).not.toContain("fg: theme.success }}>+{s().added}")
    expect(fileEdits).not.toContain("fg: theme.error }}>−{s().removed}")
  })
})

describe("webmcp toggle chip stays calm", () => {
  test("the toggle view renders no filled error background", async () => {
    const chip = await read("component/webmcp-chip.tsx")
    expect(chip).not.toContain("background={theme.error}")
    expect(chip).toContain("webMcpChipRisk")
  })

  test("status chips share one grammar: brightness for on/off, a warning bang for risk", async () => {
    const chip = await read("component/webmcp-chip.tsx")
    const modes = await read("component/mode-chips.tsx")
    for (const source of [chip, modes]) {
      expect(source).not.toContain("inactiveFg={theme.warning}")
      expect(source).not.toContain("activeFg={theme.warning}")
    }
    expect(modes).toContain('risk={sync.data.isolation.mode === "full-access"}')
    expect(modes).toContain("<span style={{ fg: theme.warning, bold: true }}> ! </span>")
  })
})
