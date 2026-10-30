import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { createServer, type Socket } from "node:net"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Worker } from "node:worker_threads"
import xterm from "@xterm/headless"
import unicode11 from "@xterm/addon-unicode11"
import { spawn } from "node-pty"

const root = fileURLToPath(new URL("../", import.meta.url))
const { Terminal } = xterm
const { Unicode11Addon } = unicode11
interface State {
  id: string
  value: string
  focus: string
  top: number
  mounted: number
  wheelEvents: number
  chunks: number
  width: number
  height: number
  frame: number
  nativeFrame: string
  capabilities: unknown
}

// node-pty 1.1.0 ships its macOS spawn helper without the executable bit.
// Repair only this development dependency's metadata, never runtime binaries.
function preparePty() {
  if (process.platform === "win32") return
  const directory = dirname(createRequire(import.meta.url).resolve("node-pty/package.json"))
  for (const relative of ["build/Release/spawn-helper", `prebuilds/${process.platform}-${process.arch}/spawn-helper`]) {
    const helper = join(directory, relative)
    if (existsSync(helper) && !(statSync(helper).mode & 0o100)) chmodSync(helper, statSync(helper).mode | 0o100)
  }
}

export async function terminalQuality(tmux?: string) {
  preparePty()
  const terminal = new Terminal({ cols: 48, rows: 16, allowProposedApi: true, scrollback: 0 })
  terminal.loadAddon(new Unicode11Addon())
  terminal.unicode.activeVersion = "11"
  const states = new Map<string, State>()
  const screens = new Map<string, string[]>()
  let control: Socket | undefined
  let controlError: Error | undefined
  let lastState: State | undefined
  let transcript = ""
  let serial = 0
  let exit: { exitCode: number, signal?: number } | undefined
  const server = createServer(socket => {
    if (control) {
      socket.destroy()
      return
    }
    control = socket
    let pending = ""
    socket.on("error", error => { controlError = error })
    socket.on("data", data => {
      pending += data.toString()
      if (pending.length > 65536) {
        controlError = new Error("Unbounded control message")
        socket.destroy()
        return
      }
      let end: number
      while ((end = pending.indexOf("\n")) >= 0) {
        try {
          const state = JSON.parse(pending.slice(0, end)) as State
          states.set(state.id, state)
        } catch (error) { controlError = error as Error }
        pending = pending.slice(end + 1)
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const lines = () => Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true) ?? "")
  terminal.onTitleChange(title => {
    if (title.startsWith("ax-terminal;")) screens.set(title.slice("ax-terminal;".length), lines())
  })
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
    !/^(AX_CODE_TUI_|TERM|COLORTERM|SSH_|TMUX|STY|NO_COLOR|FORCE_COLOR)/.test(key))) as Record<string, string>
  env.AX_CODE_TUI_NATIVE_OFFLINE = "1"
  env.TERM = "xterm-256color"
  env.COLORTERM = "truecolor"
  let child: ReturnType<typeof spawn> | undefined
  const tmuxSocket = `ax-tui-quality-${process.pid}-${Date.now()}`
  const deadline = Date.now() + 45000
  async function waitFor(predicate: () => boolean, message: string) {
    while (!predicate()) {
      assert.ifError(controlError)
      assert.ok(!exit, `Terminal child exited early: ${JSON.stringify(exit)}\n${transcript.slice(-6000)}`)
      assert.ok(Date.now() < deadline, `${message}\n${transcript.slice(-6000)}`)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  }
  async function wait(id: string) {
    // The PTY OSC barrier and the independent control ACK must both arrive.
    await waitFor(() => states.has(id) && screens.has(id), `Missing barrier/ACK ${id}`)
    const state = states.get(id)!
    lastState = state
    const screen = screens.get(id)!
    if (process.platform === "win32") console.error("AX_TERMINAL_BARRIER", id, screen[0])
    states.delete(id)
    screens.delete(id)
    assert.ok(state.mounted <= state.height + 8, JSON.stringify(state))
    return { state, screen }
  }
  async function command(kind: string, fields: Record<string, unknown> = {}) {
    const id = String(++serial)
    control!.write(JSON.stringify({ kind, id, ...fields }) + "\n")
    return wait(id)
  }
  const marker = (screen: string[]) => {
    const row = screen.findIndex(line => /ROW-\d{5}/.test(line))
    assert.ok(row >= 0, `Missing visible row:\n${screen.join("\n")}`)
    return [screen[row].match(/ROW-\d{5}/)![0], row]
  }
  try {
    const args = ["--experimental-ffi", "--disable-warning=ExperimentalWarning",
      join(root, "test/fixtures/terminal-application.ts"), String(address.port)]
    const tmuxArgs = ["-u", "-L", tmuxSocket, "-f", join(root, "test/fixtures/quality-tmux.conf"),
      "new-session", "-s", "quality", process.execPath, ...args]
    // Pin Windows Unicode behavior to node-pty's bundled ConPTY. The runner's
    // legacy system host loses emoji and counts combining marks as cells.
    child = spawn(tmux ?? process.execPath, tmux ? tmuxArgs : args,
    { cwd: root, cols: 48, rows: 16, name: env.TERM, env, useConpty: true, useConptyDll: true })
    if (process.platform === "win32") console.error("AX_TERMINAL_SPAWNED")
    child.onExit(event => { exit = event })
    child.onData(data => {
      transcript += data
      if (transcript.length > 4 * 1024 * 1024) {
        controlError = new Error("Unbounded terminal output")
        return
      }
      terminal.write(data)
    })
    // Let xterm answer real device/cursor queries through the PTY input path.
    terminal.onData(data => child!.write(data))
    const initial = await wait("ready")
    assert.ok(initial.screen[0].includes("Unicode: 中文 cafe\u0301 Ω 😀"), initial.screen.join("\n"))
    assert.deepEqual(marker(initial.screen), ["ROW-05000", 3])
    // Check cell width independently of a text-only screen snapshot.
    assert.equal(terminal.buffer.active.getLine(0)!.getCell(9)!.getWidth(), 2)
    assert.equal(terminal.buffer.active.getLine(0)!.getCell(21)!.getWidth(), 2)
    const firstCell = terminal.buffer.active.getLine(0)!.getCell(0)!
    if (!tmux) {
      assert.ok(firstCell.isFgRGB() && firstCell.isBgRGB(), "Truecolor attributes were lost")
      assert.equal(firstCell.getFgColor(), 0xabcdef)
      assert.equal(firstCell.getBgColor(), 0x123456)
    }
    const pasted = "paste 中文 cafe\u0301"
    for (const chunk of ["\x1b[20", "0~paste 中", "文 cafe\u0301\x1b[20", "1~"]) {
      child.write(chunk)
      await new Promise(resolve => setTimeout(resolve, 8))
    }
    const input = await command("input", { value: pasted })
    assert.ok(input.screen[1].includes(pasted), input.screen.join("\n"))
    child.write("\t")
    assert.equal((await command("focus", { focus: "second" })).state.focus, "second")
    child.write("\x1b[")
    await new Promise(resolve => setTimeout(resolve, 8))
    child.write("Z")
    assert.equal((await command("focus", { focus: "editor" })).state.focus, "editor")
    // A fragmented left-arrow followed by insertion must edit at a cell boundary.
    child.write("\x1b[")
    await new Promise(resolve => setTimeout(resolve, 8))
    child.write("DX")
    const edited = "paste 中文 cafXe\u0301"
    const edit = await command("input", { value: edited })
    assert.equal(edit.state.value, edited)
    assert.ok(edit.screen[1].includes(edited), edit.screen.join("\n"))
    child.write("\x1b[<64;4;6M".repeat(20))
    const moved = await command("wheel", { expected: 20 })
    assert.deepEqual(marker(moved.screen), ["ROW-04980", 3])
    assert.ok(moved.state.frame - initial.state.frame <= 60, "Wheel repaint count is unbounded")
    const parked = marker(moved.screen)
    const streamed = await command("stream", { count: 200 })
    assert.equal(streamed.state.chunks, 200)
    assert.deepEqual(marker(streamed.screen), parked)
    for (const [width, height] of [[32, 12], [72, 24], [48, 16]]) {
      terminal.resize(width, height)
      child.resize(width, height)
      const resized = await command("resize", { width, height })
      assert.deepEqual(marker(resized.screen), parked)
      assert.ok(resized.screen[0].includes("Unicode: 中文 cafe\u0301 Ω 😀"))
    }
    const idle = await command("idle")
    const again = await command("idle")
    assert.equal(again.state.frame, idle.state.frame, "Idle application repaints indefinitely")
    const shutdownStart = transcript.length
    control!.write('{"kind":"quit"}\n')
    // A tmux client exits 0 when the session ends regardless of the pane
    // process status, so require the fixture to confirm clean teardown.
    const shutdownDeadline = Math.min(deadline, Date.now() + 5000)
    while (!states.has("shutdown") && Date.now() < shutdownDeadline) {
      assert.ifError(controlError)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.ok(states.has("shutdown"), "Terminal application did not confirm shutdown")
    while (!exit && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(exit, "Terminal child failed to exit")
    assert.equal(exit.exitCode, 0, transcript.slice(-6000))
    await new Promise<void>(resolve => terminal.write("", resolve))
    assert.equal(terminal.buffer.active.type, "normal", "Alternate screen was not restored")
    assert.equal(terminal.modes.bracketedPasteMode, false, "Bracketed paste mode was not restored")
    assert.match(transcript.slice(shutdownStart), /\x1b\[\?25h/, "Cursor was not restored during shutdown")
    return { status: "AX_TERMINAL_QUALITY_COMPLETE", transport: process.platform === "win32" ? "ConPTY" : "POSIX PTY",
      multiplexer: tmux ? spawnSync(tmux, ["-V"], { encoding: "utf8" }).stdout.trim() : null,
      oracle: "xterm.js 6.0.0 Unicode 11", unicode: ["CJK", "combining marks", "Greek", "wide emoji"],
      streamUpdates: 200,
      resizes: 3, wheelEvents: 20, outputBytes: Buffer.byteLength(transcript) }
  } catch (error) {
    // ConPTY may serialize screen updates separately from forwarded OSC titles.
    // Preserve both the barrier snapshot and a later screen when a contract fails.
    await new Promise(resolve => setTimeout(resolve, 250))
    await new Promise<void>(resolve => terminal.write("", resolve))
    console.error("AX_TERMINAL_FAILURE", JSON.stringify({ state: lastState, screen: lines(),
      transcript: transcript.slice(-16000) }))
    throw error
  } finally {
    if (process.platform === "win32") console.error("AX_TERMINAL_CLEANUP_START")
    try {
      if (child && process.platform === "win32") {
        // node-pty 1.1.0's bundled ConPTY kill path disposes its worker only
        // after another data event. An already drained child emits no more data.
        // Use that pinned development dependency's drain-aware disposer directly.
        const connection = (child as unknown as {
          _agent: { _conoutSocketWorker: { dispose(): void, _worker: Worker } }
        })._agent._conoutSocketWorker
        child.kill()
        connection.dispose()
        const cleanupDeadline = Date.now() + 3000
        while (connection._worker.threadId !== -1 && Date.now() < cleanupDeadline) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        assert.equal(connection._worker.threadId, -1, "ConPTY output worker failed to stop")
      } else if (child && !exit) {
        // On POSIX avoid signaling a potentially reused PID after child exit.
        child.kill()
      }
      if (process.platform === "win32") console.error("AX_TERMINAL_CHILD_CLOSED")
    } finally {
      if (tmux) spawnSync(tmux, ["-L", tmuxSocket, "kill-server"], { stdio: "ignore", timeout: 5000 })
      control?.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
      terminal.dispose()
      if (process.platform === "win32") console.error("AX_TERMINAL_CLEANUP_COMPLETE")
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(!process.argv[2] || process.argv[2] === "--tmux",
    "Usage: node script/terminal-quality.ts [--tmux [binary]]")
  console.log(JSON.stringify(await terminalQuality(process.argv[2] ? process.argv[3] ?? "tmux" : undefined)))
}
