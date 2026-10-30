"""POSIX PTY regression driver; standard library only, no runtime dependency.

The screen decoder intentionally supports only AX's ASCII fixture output and
single-cell scrollbar glyphs. Unsupported screen operations fail closed. This
is not a general terminal emulator or a Unicode/terminal compatibility claim.
"""
import codecs
import errno
import fcntl
import json
import os
from pathlib import Path
import re
import select
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import time


class Screen:
    def __init__(self, width, height):
        self.width, self.height = width, height
        self.cells = [[" "] * width for _ in range(height)]
        self.x = self.y = 0
        self.saved = (0, 0)
        self.pending = ""
        self.decoder = codecs.getincrementaldecoder("utf-8")()
        self.frames = []
        self.barriers = set()
        self.in_frame = False

    def lines(self):
        return ["".join(row) for row in self.cells]

    def resize(self, width, height):
        self.cells = [(row[:width] + [" "] * width)[:width] for row in self.cells[:height]]
        self.cells += [[" "] * width for _ in range(height - len(self.cells))]
        self.width, self.height = width, height
        self.x, self.y = min(self.x, width - 1), min(self.y, height - 1)

    def feed(self, data):
        self.pending += self.decoder.decode(data)
        while self.pending:
            if self.pending.startswith("\x1b"):
                if len(self.pending) < 2:
                    return
                kind = self.pending[1]
                if kind == "[":
                    match = re.match(r"\x1b\[([0-?]*)([ -/]*)([@-~])", self.pending)
                    if not match:
                        assert len(self.pending) < 256, "Invalid or unbounded CSI"
                        return
                    self.csi(*match.groups())
                    self.pending = self.pending[match.end():]
                    continue
                if kind in "]P_":
                    match = re.search(r"\x07|\x1b\\", self.pending[2:])
                    if not match:
                        assert len(self.pending) < 4096, "Unbounded terminal string"
                        return
                    body = self.pending[2:2 + match.start()]
                    if kind == "]" and body.startswith("777;ax-pty;"):
                        assert not self.in_frame, "Output barrier inside an unfinished frame"
                        self.barriers.add(body.removeprefix("777;ax-pty;"))
                    else:
                        # Recognize startup probes only. In particular, arbitrary
                        # OSC image/text protocols must never disappear silently.
                        assert kind == "]" and (
                            body in ("10;?", "11;?", "1337;Capabilities")
                            or re.fullmatch(r"4;\d+;\?", body)
                            or body == "99;i=ax-tui-notifications:p=?;"
                            or not self.frames and body in ("66;w=2; ", "66;s=2; ")
                        ), f"Unsupported terminal string: {kind}{body!r}"
                    self.pending = self.pending[2 + match.end():]
                    continue
                if kind == "7":
                    self.saved = (self.x, self.y)
                elif kind == "8":
                    self.x, self.y = self.saved
                elif kind == "=":
                    pass  # Application keypad mode.
                else:
                    raise AssertionError(f"Unsupported escape: {self.pending[:30]!r}")
                self.pending = self.pending[2:]
                continue
            char, self.pending = self.pending[0], self.pending[1:]
            if char == "\r":
                self.x = 0
            elif char == "\n":
                self.y += 1
                if self.y >= self.height:
                    self.cells.pop(0)
                    self.cells.append([" "] * self.width)
                    self.y = self.height - 1
            elif char == "\b":
                self.x = max(0, self.x - 1)
            elif char == "\x07":
                pass
            else:
                assert " " <= char <= "~" or char in "▀▄█▌▐░▒▓│─┃━", f"Unsupported cell: {char!r}"
                assert 0 <= self.x < self.width, "Fixture must not depend on implicit wrapping"
                self.cells[self.y][self.x] = char
                self.x += 1

    def csi(self, params, intermediate, final):
        sequence = f"{params}{intermediate}{final}"
        if final in "hl" and params.startswith("?"):
            modes = [int(value) for value in params[1:].split(";")]
            for mode in modes:
                if mode == 2026:
                    if final == "h":
                        assert not self.in_frame, "Nested synchronized frame"
                        self.in_frame = True
                    else:
                        if self.in_frame:
                            self.frames.append(self.lines())
                        self.in_frame = False
                elif mode == 1049:
                    self.cells = [[" "] * self.width for _ in range(self.height)]
                    self.x = self.y = 0
                else:
                    assert mode in (12, 25, 1000, 1002, 1003, 1004, 1006, 1015, 1016, 2004, 2027, 2031), sequence
            return
        if final == "m" or sequence in (
            "6n", "14t", ">0q", "?u", "?1016$p", "?2027$p", "?2031$p", "?1004$p", "?2004$p", "?2026$p",
        ) or re.fullmatch(r"[0-6] q", sequence):
            return  # Attributes, cursor style, and the fixture's capability queries.
        assert not intermediate and not params.startswith(("?", ">", "<", "=")), sequence
        values = [int(value) if value else 0 for value in params.split(";")]
        amount = values[0] or 1
        if final == "s":
            self.saved = (self.x, self.y)
        elif final == "u":
            self.x, self.y = self.saved
        elif final in "Hf":
            self.y = min(self.height - 1, amount - 1)
            self.x = min(self.width - 1, (values[1] or 1) - 1 if len(values) > 1 else 0)
        elif final == "G":
            self.x = min(self.width - 1, amount - 1)
        elif final == "A":
            self.y = max(0, self.y - amount)
        elif final == "B":
            self.y = min(self.height - 1, self.y + amount)
        elif final == "C":
            self.x = min(self.width - 1, self.x + amount)
        elif final == "D":
            self.x = max(0, self.x - amount)
        elif final == "J":
            assert values[0] in (0, 2, 3), sequence
            if values[0] == 2:
                self.cells = [[" "] * self.width for _ in range(self.height)]
            elif values[0] == 0:
                self.cells[self.y][self.x:] = [" "] * (self.width - self.x)
                for row in range(self.y + 1, self.height):
                    self.cells[row] = [" "] * self.width
        elif final == "K":
            assert values[0] in (0, 1, 2), sequence
            start = self.x if values[0] == 0 else 0
            end = self.x + 1 if values[0] == 1 else self.width
            self.cells[self.y][start:end] = [" "] * (end - start)
        elif final == "r":
            assert params in ("", f"1;{self.height}"), "Partial scroll regions are unsupported"
            self.x = self.y = 0
        else:
            raise AssertionError(f"Unsupported CSI: {sequence!r}")


def decoder_contract():
    screen = Screen(24, 4)
    stream = b"\x1b[?1049h\x1b[?2026h\x1b[2;3HMARKER-0007\x1b[?2026l\x1b]777;ax-pty;one\x07"
    for byte in stream:
        screen.feed(bytes([byte]))
    assert screen.frames[0][1][2:13] == "MARKER-0007"
    assert "one" in screen.barriers
    screen.feed(b"\x1b[2;3H\x1b[K\x1b[3;1HMARKER-0008")
    assert "MARKER-0007" not in "\n".join(screen.lines())
    assert screen.lines()[2].startswith("MARKER-0008")
    screen.resize(16, 3)
    assert len(screen.lines()) == 3 and len(screen.lines()[0]) == 16
    try:
        screen.feed(b"\x1b[2L")
    except AssertionError:
        pass
    else:
        raise AssertionError("Unsupported insert-line must fail, not silently misread the screen")


class Harness:
    def __init__(self, node):
        self.screen = Screen(48, 16)
        self.master, slave = os.openpty()
        self.original_modes = termios.tcgetattr(slave)[3]
        self.control, child_control = socket.socketpair()
        self.errors = tempfile.TemporaryFile()
        self.control_buffer = b""
        self.replies = {}
        self.transcript = bytearray()
        self.serial = 0
        self.events = 0
        self.deadline = time.monotonic() + 30
        self.resize_fd(slave, 48, 16)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("AX_CODE_TUI_", "TERM", "COLORTERM", "SSH_", "TMUX", "STY"))}
        env.update(TERM="xterm-256color", AX_CODE_TUI_NATIVE_OFFLINE="1")
        try:
            self.child = subprocess.Popen(
                [node, "--experimental-ffi", "--disable-warning=ExperimentalWarning",
                 str(Path(__file__).with_suffix(".mjs")), str(child_control.fileno())],
                stdin=slave, stdout=slave, stderr=self.errors, pass_fds=(child_control.fileno(),),
                start_new_session=True, env=env,
            )
        except BaseException:
            os.close(self.master)
            self.control.close()
            self.errors.close()
            raise
        finally:
            os.close(slave)
            child_control.close()

    @staticmethod
    def resize_fd(fd, width, height):
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))

    def pump(self):
        assert time.monotonic() < self.deadline, "PTY scenario deadline exceeded"
        assert self.child.poll() is None, f"Child exited early: {self.child.returncode}"
        readable, _, _ = select.select([self.master, self.control], [], [], 0.05)
        for source in readable:
            if source == self.master:
                data = os.read(self.master, 65536)
                assert data, "PTY closed early"
                self.transcript.extend(data)
                assert len(self.transcript) < 2 * 1024 * 1024, "Unbounded terminal output"
                self.screen.feed(data)
            else:
                data = self.control.recv(65536)
                assert data, "Control channel closed early"
                self.control_buffer += data
                assert len(self.control_buffer) < 65536, "Unbounded control message"
                while b"\n" in self.control_buffer:
                    line, self.control_buffer = self.control_buffer.split(b"\n", 1)
                    reply = json.loads(line)
                    self.replies[reply["id"]] = reply

    def wait(self, identifier):
        while identifier not in self.replies or identifier not in self.screen.barriers:
            self.pump()
        reply = self.replies.pop(identifier)
        self.screen.barriers.remove(identifier)
        assert reply["mounted"] <= self.screen.height + 8, reply
        return reply

    def command(self, kind, **fields):
        self.serial += 1
        identifier = str(self.serial)
        self.control.sendall((json.dumps(dict(id=identifier, kind=kind, **fields)) + "\n").encode())
        return self.wait(identifier)

    def wheel(self, direction, count):
        # SGR reports are real terminal bytes, not calls into AX's mock-input helper.
        report = f"\x1b[<{64 if direction == 'up' else 65};4;5M".encode()
        os.write(self.master, report * count)
        self.events += count
        return self.command("wheel", expected=self.events)

    def close(self):
        if self.child.poll() is None:
            os.killpg(self.child.pid, signal.SIGKILL)
        self.child.wait(timeout=5)
        os.close(self.master)
        self.control.close()
        self.errors.close()


def top_marker(lines):
    for row, line in enumerate(lines):
        match = re.search(r"MARKER-(\d{4})", line)
        if match:
            return int(match[1]), row
    raise AssertionError("No visible marker:\n" + "\n".join(lines))


def main():
    decoder_contract()
    harness = Harness(sys.argv[1])
    try:
        initial = harness.wait("ready")
        before = top_marker(harness.screen.lines())
        frame_start = len(harness.screen.frames)
        moved = harness.wheel("up", 30)
        parked = top_marker(harness.screen.lines())
        assert parked[0] == before[0] - 30, (before, parked)
        assert moved["top"] == initial["top"] - 30, moved
        wheel_frames = len(harness.screen.frames) - frame_start
        # Virtual rows can need a mount pass plus a measured-layout pass. Allow
        # those passes, but never an unbounded invalidation loop or zero repaint.
        assert 1 <= wheel_frames <= 2 * 30 + 4, wheel_frames
        for chunk in range(1, 13):
            start = len(harness.screen.frames)
            state = harness.command("stream")
            assert state["chunks"] == chunk and state["top"] == moved["top"], state
            assert f"Stream chunks: {chunk}" in harness.screen.lines()[0]
            frames = harness.screen.frames[start:]
            assert frames, "Stream mutation produced no terminal repaint"
            for frame in frames:
                assert top_marker(frame) == parked, "Parked marker moved during below-viewport streaming"
        later = harness.wheel("down", 8)
        assert top_marker(harness.screen.lines())[0] == parked[0] + 8
        assert later["top"] == moved["top"] + 8
        anchor = top_marker(harness.screen.lines())
        harness.screen.resize(32, 12)
        harness.resize_fd(harness.master, 32, 12)
        os.kill(harness.child.pid, signal.SIGWINCH)
        resized = harness.command("resize", width=32, height=12)
        assert top_marker(harness.screen.lines()) == anchor
        assert resized["top"] == later["top"]
        frame_start = len(harness.screen.frames)
        harness.command("idle")
        assert len(harness.screen.frames) == frame_start, "Settled UI scheduled unsolicited repaints"
        harness.control.sendall(b'{"kind":"quit"}\n')
        # Drain shutdown bytes so a full PTY cannot prevent the child from exiting.
        deadline = time.monotonic() + 5
        shutdown = bytearray()
        while harness.child.poll() is None:
            assert time.monotonic() < deadline, "Renderer failed to exit cleanly"
            ready, _, _ = select.select([harness.master], [], [], 0.05)
            if ready:
                try:
                    shutdown.extend(os.read(harness.master, 65536))
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
        assert harness.child.returncode == 0, harness.child.returncode
        while select.select([harness.master], [], [], 0)[0]:
            try:
                data = os.read(harness.master, 65536)
                if not data:
                    break
                shutdown.extend(data)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                break
        assert b"\x1b[?1049l" in shutdown, "Alternate screen was not restored"
        assert b"\x1b[?25h" in shutdown, "Cursor was not restored"
        mode_mask = termios.ICANON | termios.ECHO | termios.ISIG
        assert termios.tcgetattr(harness.master)[3] & mode_mask == harness.original_modes & mode_mask
        print(json.dumps(dict(status="AX_PTY_SCROLL_COMPLETE", wheelEvents=harness.events,
                              wheelFrames=wheel_frames, streamChunks=12, resize=[32, 12])))
    except BaseException:
        print("PTY screen:\n" + "\n".join(harness.screen.lines()), file=sys.stderr)
        print("PTY tail: " + repr(bytes(harness.transcript[-4000:])), file=sys.stderr)
        harness.errors.seek(0)
        print("Child stderr: " + harness.errors.read().decode(errors="replace"), file=sys.stderr)
        raise
    finally:
        harness.close()


if __name__ == "__main__":
    main()
