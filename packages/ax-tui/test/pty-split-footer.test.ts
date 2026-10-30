import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Terminal } from "@xterm/headless"
import { expect, test } from "vitest"

const hasTmux = process.platform !== "win32" && spawnSync("tmux", ["-V"]).error?.message.includes("ENOENT") !== true

type Segment = { data?: string; resize?: [number, number]; id?: string }

for (const tmux of [false, true]) for (const sigterm of [false, true]) {
  test.skipIf(process.platform === "win32" || (tmux && !hasTmux))(
    `${tmux ? "tmux pane" : "POSIX PTY"}: split-footer append, resize burst, and ${sigterm ? "SIGTERM" : "normal"} teardown`,
    async () => {
      const result = spawnSync("python3", [fileURLToPath(new URL("fixtures/pty-split-footer.py", import.meta.url)),
        process.execPath, ...(tmux ? ["--tmux"] : []), ...(sigterm ? ["--sigterm"] : [])], {
        cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 40_000,
        maxBuffer: 8 * 1024 * 1024,
      })
      expect(result.error, result.stderr).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      const report = JSON.parse(result.stdout) as { segments: Segment[]; signals: number; commits: number }
      expect(report.signals).toBeGreaterThanOrEqual(102)
      expect(report.commits).toBe(1000)
      const output = report.segments.map(segment => Buffer.from(segment.data ?? "", "base64").toString()).join("")
      expect(output.match(/ROW-\d{4}/g)).toEqual(Array.from({ length: 1000 }, (_, i) => `ROW-${String(i).padStart(4, "0")}`))
      expect(output).not.toContain("\x1b[2J")
      expect(output).not.toMatch(/\x1b\[\?(?:47|1047|1049)[hl]/)
      expect(output.lastIndexOf("\x1b[?25h")).toBeGreaterThan(output.indexOf("ROW-0999"))
      expect(output.lastIndexOf("\x1b[?1000l")).toBeGreaterThan(output.indexOf("ROW-0999"))
      if (sigterm) {
        expect(output.match(/PENDING-SIGTERM-\d/g)).toEqual(["PENDING-SIGTERM-0", "PENDING-SIGTERM-1", "PENDING-SIGTERM-2"])
        expect(output.indexOf("PENDING-SIGTERM-2")).toBeLessThan(output.lastIndexOf("\x1b[?25h"))
      }

      // Decode the real byte stream, including DECSTBM and autowrap. Raw marker
      // counts above independently catch repainting, even if the screen looks right.
      const terminal = new Terminal({ cols: 48, rows: 16, scrollback: 5000, allowProposedApi: true })
      const screen = () => Array.from({ length: terminal.rows }, (_, row) =>
        terminal.buffer.active.getLine(terminal.buffer.active.baseY + row)?.translateToString(true) ?? "")
      try {
        for (const segment of report.segments) {
          if (segment.resize) terminal.resize(...segment.resize)
          if (segment.data) await new Promise<void>(resolve => terminal.write(Buffer.from(segment.data!, "base64"), resolve))
          if (segment.id === "ready") expect(screen().join("\n")).toContain("FOOTER-THREE")
          if (["1", "3", "5", "107"].includes(segment.id ?? "")) expect(screen().join("\n")).toContain("FOOTER-FIVE")
        }
        const rows = screen()
        const last = rows.findIndex(row => row.includes(sigterm ? "PENDING-SIGTERM-2" : "ROW-0999"))
        const prompt = rows.findIndex(row => row.includes("SHELL-PROMPT"))
        expect(last, rows.join("\n")).toBeGreaterThanOrEqual(0)
        expect(prompt, rows.join("\n")).toBeGreaterThan(last)
        expect(terminal.buffer.active.cursorY).toBe(prompt)
        expect(rows.join("\n")).not.toContain("FOOTER-")
        expect(terminal.modes.mouseTrackingMode).toBe("none")
      } finally { terminal.dispose() }
    }, 45_000,
  )
}
