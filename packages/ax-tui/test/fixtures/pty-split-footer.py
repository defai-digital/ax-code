"""POSIX split-footer driver, using only Python's standard library.

Every ACK is paired with an OSC output barrier. Resize delivery is acknowledged
one signal at a time, so a 100-event burst cannot silently coalesce in the OS.
The render clock stays paused during resize bursts, then advances to settle geometry.
"""
import base64
import errno
import fcntl
import json
import os
from pathlib import Path
import select
import shlex
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import time


class Harness:
    def __init__(self, node, tmux=False):
        self.master, self.slave = os.openpty()
        self.modes = termios.tcgetattr(self.slave)
        self.errors = tempfile.TemporaryFile()
        self.serial = 0
        self.replies = {}
        self.control_buffer = b""
        self.output = bytearray()
        self.segments = []
        self.offset = 0
        self.deadline = time.monotonic() + 35
        self.tmux = tmux
        self.temp = tempfile.TemporaryDirectory(prefix="ax-split-")
        self.resize_fd(48, 16)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("AX_CODE_TUI_", "TERM", "COLORTERM", "SSH_", "TMUX", "STY"))}
        env.update(TERM="xterm-256color", AX_CODE_TUI_NATIVE_OFFLINE="1")
        args = [node, "--experimental-ffi", "--disable-warning=ExperimentalWarning",
                str(Path(__file__).with_suffix(".mjs"))]
        if tmux:
            # A private server and pane; the recording is pane output, not tmux's
            # own alternate-screen client UI. The same program/scenario is used.
            self.server = str(Path(self.temp.name) / "tmux")
            path = str(Path(self.temp.name) / "control")
            listener = socket.socket(socket.AF_UNIX)
            listener.bind(path)
            listener.listen(1)
            self.pane_output = Path(self.temp.name) / "pane-output"
            self.pane_output.touch()
            self.tmux_call("new-session", "-d", "-x", "48", "-y", "16", "-s", "split", "sleep 60", env=env)
            self.tmux_call("set-option", "-g", "status", "off")
            self.tmux_call("set-option", "-g", "remain-on-exit", "on")
            self.tmux_call("pipe-pane", "-O", "-t", "split:0.0", "cat >> " + shlex.quote(str(self.pane_output)))
            # respawn-pane closes a pipe, so launch via send-keys into a shell.
            self.tmux_call("respawn-pane", "-k", "-t", "split:0.0", "sh")
            self.tmux_call("pipe-pane", "-O", "-t", "split:0.0", "cat >> " + shlex.quote(str(self.pane_output)))
            self.tmux_call("send-keys", "-t", "split:0.0", "exec " + shlex.join(args + [path]), "Enter")
            listener.settimeout(5)
            self.control, _ = listener.accept()
            listener.close()
            self.pid = int(self.tmux_call("display-message", "-p", "-t", "split:0.0", "#{pane_pid}").stdout)
            self.child = None
        else:
            self.control, child_control = socket.socketpair()
            self.child = subprocess.Popen(args + [str(child_control.fileno())], stdin=self.slave, stdout=self.slave,
                                          stderr=self.errors, pass_fds=(child_control.fileno(),),
                                          start_new_session=True, env=env)
            self.pid = self.child.pid
            child_control.close()

    def tmux_call(self, *args, **kwargs):
        return subprocess.run(["tmux", "-S", self.server, *args], check=True, capture_output=True, **kwargs)

    def resize_fd(self, width, height):
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))

    def read_output(self):
        if self.tmux:
            data = self.pane_output.read_bytes()
            self.output.extend(data[len(self.output):])
        elif select.select([self.master], [], [], 0)[0]:
            try:
                self.output.extend(os.read(self.master, 65536))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
        assert len(self.output) < 4 * 1024 * 1024, "Unbounded terminal output"

    def wait(self, identifier):
        barrier = f"\x1b]777;ax-split;{identifier}\x07".encode()
        while identifier not in self.replies or barrier not in self.output:
            assert time.monotonic() < self.deadline, f"Timeout awaiting {identifier}"
            self.read_output()
            if select.select([self.control], [], [], 0.005)[0]:
                data = self.control.recv(65536)
                assert data, "Control channel closed early"
                self.control_buffer += data
                while b"\n" in self.control_buffer:
                    line, self.control_buffer = self.control_buffer.split(b"\n", 1)
                    reply = json.loads(line)
                    self.replies[reply["id"]] = reply
        self.segments.append({"data": base64.b64encode(self.output[self.offset:]).decode(), "id": identifier})
        self.offset = len(self.output)
        return self.replies.pop(identifier)

    def command(self, kind, **fields):
        self.serial += 1
        identifier = str(self.serial)
        self.control.sendall((json.dumps(dict(id=identifier, kind=kind, **fields)) + "\n").encode())
        return self.wait(identifier)

    def resize(self, width, height, expected, drain=True):
        self.segments.append({"resize": [width, height]})
        if self.tmux:
            self.tmux_call("resize-window", "-t", "split:0", "-x", str(width), "-y", str(height))
        else:
            self.resize_fd(width, height)
            os.kill(self.pid, signal.SIGWINCH)
        return self.command("resize" if drain else "signal", width=width, height=height, expected=expected)

    def finish(self, terminate):
        if terminate:
            state = self.command("pending-sigterm")
            assert state["pending"] == 3, state
            os.kill(self.pid, signal.SIGTERM)
        else:
            self.control.sendall(b'{"kind":"quit"}\n')
        deadline = time.monotonic() + 5
        while True:
            self.read_output()
            done = (self.tmux_call("display-message", "-p", "-t", "split:0.0", "#{pane_dead}").stdout.strip() == b"1"
                    if self.tmux else self.child.poll() is not None)
            if done and b"SHELL-PROMPT" in self.output:
                break
            assert time.monotonic() < deadline, "Teardown did not finish"
            time.sleep(0.01)
        # Drain bytes written immediately before process exit.
        self.read_output()
        if not self.tmux:
            assert self.child.returncode == 0, self.child.returncode
            restored = termios.tcgetattr(self.slave)
            for index in [0, 1, 2, 3]:
                assert restored[index] == self.modes[index], (index, self.modes, restored)
        self.segments.append({"data": base64.b64encode(self.output[self.offset:]).decode(), "id": "shutdown"})

    def close(self):
        if self.tmux:
            self.tmux_call("kill-server")
        elif self.child.poll() is None:
            os.killpg(self.pid, signal.SIGKILL)
            self.child.wait(timeout=5)
        os.close(self.master)
        os.close(self.slave)
        self.control.close()
        self.errors.close()
        self.temp.cleanup()


def main():
    harness = Harness(sys.argv[1], "--tmux" in sys.argv)
    try:
        state = harness.wait("ready")
        assert state["height"] == 3, state
        state = harness.command("footer")
        assert state["height"] == 5, state
        harness.command("queue", start=0, end=400)
        state = harness.resize(32, 12, 1)
        assert state["pending"] == 0 and state["width"] == 32, state
        harness.command("queue", start=400, end=800)
        state = harness.resize(60, 20, 2)
        assert state["pending"] == 0 and state["width"] == 60, state
        harness.command("queue", start=800, end=1000)
        for event in range(100):
            state = harness.resize(40 + event % 2, 14 + event % 2, event + 3, drain=False)
            assert state["pending"] == 200 and state["width"] == 60, state
        state = harness.command("resize", expected=102, width=41, height=15)
        assert state["signals"] >= 102 and state["pending"] == 0 and state["commits"] == 1000, state
        harness.command("idle")
        harness.finish("--sigterm" in sys.argv)
        print(json.dumps({"segments": harness.segments, "signals": state["signals"], "commits": state["commits"]}))
    except BaseException:
        harness.errors.seek(0)
        sys.stderr.write(harness.errors.read().decode(errors="replace"))
        sys.stderr.write(repr(bytes(harness.output[-1000:])))
        raise
    finally:
        harness.close()


if __name__ == "__main__":
    main()
