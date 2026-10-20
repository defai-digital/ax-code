"""Real frontend PTY checks; Python 3 standard library only."""
import errno
import fcntl
import os
import pty
import re
import select
import signal
import struct
import sys
import shutil
import tempfile
import tty
from pathlib import Path
import termios
import time

NODE = sys.argv[1]
COMMAND = [NODE, "../../script/node-ffi-runner.mjs", "--import", "tsx", "--import", "../../script/solid-loader.mjs", "--conditions=node", "script/inline-pty-fixture.tsx"]
MARK = rb"\x1b\]777;inline;([^\x07]+)\x07"


# A relay records application bytes before a multiplexer rewrites escape codes.
# Input and resize events still travel through screen/tmux and both real PTYs.
if "--relay" in sys.argv:
    logfile = sys.argv[sys.argv.index("--relay") + 1]
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(COMMAND[0], COMMAND)
    tty.setraw(0)
    def forward_size(*_):
        fcntl.ioctl(fd, termios.TIOCSWINSZ, fcntl.ioctl(0, termios.TIOCGWINSZ, b"\0" * 8))
        os.kill(pid, signal.SIGWINCH)
    signal.signal(signal.SIGWINCH, forward_size)
    forward_size()
    with open(logfile, "wb", buffering=0) as log:
        while True:
            ready, _, _ = select.select([0, fd], [], [], 5)
            if fd in ready:
                try:
                    chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                log.write(chunk)
                os.write(1, chunk)
            if 0 in ready:
                chunk = os.read(0, 65536)
                if not chunk:
                    break
                os.write(fd, chunk)
    _, status = os.waitpid(pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status))


def assert_cursor_below(data, last_record, height):
    # Decode cursor movement after the last committed record. No further
    # transcript writes occur in this suffix, so scrolling adjusts one anchor.
    offset = data.rfind(last_record.encode())
    positions = list(re.finditer(rb"\x1b\[(\d+);(\d+)H", data[:offset]))
    assert positions, "No cursor address before final transcript record"
    row = anchor = int(positions[-1][1]) - 1
    for token in re.finditer(rb"\x1b\[([0-?]*)([ -/]*)([@-~])|\n", data[offset:]):
        if token[0] == b"\n":
            row += 1
            if row >= height:
                row = height - 1
                anchor -= 1
            continue
        params, intermediate, final = token.groups()
        if intermediate or params.startswith((b"?", b">", b"<", b"=")):
            continue
        values = [int(value or 0) for value in params.split(b";")]
        amount = values[0] or 1
        if final in (b"H", b"f", b"d"):
            row = amount - 1
        elif final in (b"A", b"F"):
            row = max(0, row - amount)
        elif final in (b"B", b"E"):
            row = min(height - 1, row + amount)
        elif final == b"r":
            row = 0
        elif final == b"S":
            anchor -= amount
        elif final == b"J":
            assert values[0] == 0 and row > anchor, "Footer teardown erased transcript"
    assert row > anchor, f"Final cursor row {row} is not below transcript row {anchor}"


def run(width, height, storm=False, terminate=False, prefix=None, logfile=None, full=False):
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp((prefix or COMMAND)[0], prefix or COMMAND)
    def size(w, h):
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", h, w, 0, 0))
        os.kill(pid, signal.SIGWINCH)
    size(width, height)
    original_mode = termios.tcgetattr(fd)
    data = b""
    seen = set()
    app_data = b""
    measurement_start = None
    measurement_end = None
    start = time.monotonic()
    storm_count = 0
    stream_start = None
    try:
        while time.monotonic() - start < 35:
            if select.select([fd], [], [], .01)[0]:
                try:
                    chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                data += chunk
            app_data = Path(logfile).read_bytes() if logfile and Path(logfile).exists() else data
            for match in re.finditer(MARK, app_data):
                stage = match[1].decode()
                if stage in seen:
                    continue
                seen.add(stage)
                if stage == "draft":
                    os.write(fd, "PTY user \u4e2d\u6587 \U0001f680\r".encode())
                if stage == "stream":
                    stream_start = time.monotonic()
                    measurement_start = match.end()
                if stage == "stream-end":
                    measurement_end = match.start()
                    if storm:
                        assert storm_count == 100, "Resize storm did not finish during streaming"
                if stage == "allow":
                    os.write(fd, b"\r")
                if stage == "deny":
                    os.write(fd, b"\x03")
                if stage == "exit":
                    os.write(fd, b"\x03")
                    time.sleep(.1)
                    os.write(fd, b"\x03")
            if stream_start is not None:
                if terminate and time.monotonic() - stream_start > .25:
                    os.kill(pid, signal.SIGTERM)
                    stream_start = None
                elif storm and storm_count < 100:
                    size(width + storm_count % 2, height)
                    storm_count += 1
                    if storm_count == 100:
                        size(width, height)
        else:
            raise AssertionError("PTY timed out: " + repr(data[-2000:]))
        _, status = os.waitpid(pid, 0)
        assert os.waitstatus_to_exitcode(status) == 0, repr(data[-4000:])
        restored_mode = termios.tcgetattr(fd)
        mask = termios.ECHO | termios.ICANON | termios.ISIG
        assert restored_mode[3] & mask == original_mode[3] & mask, "Terminal input mode was not restored"
    finally:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.close(fd)
    if logfile and not Path(logfile).exists():
        raise RuntimeError("multiplexer could not start relay: " + repr(data[-1200:]))
    data = app_data
    if full:
        assert measurement_start is not None and measurement_end is not None, repr(data[-3000:])
        return (measurement_end - measurement_start) / 20
    assert b"\x1b_G" not in data and not re.search(rb"\x1bP[0-9;]*q", data), "Pixel graphics in inline output"
    assert b"\x1b[2J" not in data, "Display was erased"
    assert b"\x1b[?1049l" not in data, "Alternate screen was popped"
    for mode in [25, 2004, 1000, 1002, 1003, 1006]:
        transitions = re.findall(rb"\x1b\[\?" + str(mode).encode() + rb"([hl])", data)
        assert transitions and transitions[-1] == (b"h" if mode == 25 else b"l"), (mode, data[-1000:])
    # Native scrollback rows end with erase-to-EOL plus CR/LF. Footer repaints
    # use cursor addressing and have no row newline; count only committed rows.
    commits = re.findall(rb"\x1b\[49m([^\r\n]*?)\x1b\[0m\x1b\[K\r*\n", data)
    transcript = b"\n".join(commits)
    transcript = re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", transcript).decode("utf8", "replace")
    expected = ["You: PTY user \u4e2d\u6587 \U0001f680"]
    tokens = re.findall(r"Stream-(\d+) \u4e2d\u6587 \U0001f680", transcript)
    assert tokens and [int(token) for token in tokens] == list(range(len(tokens))), "Stream token lost, reordered, or duplicated"
    if not terminate:
        assert len(tokens) == 20
    expected += [f"Stream-{token} \u4e2d\u6587 \U0001f680" for token in tokens]
    if not terminate:
        expected += ["const pty_code = 42", "PTY final", "[completed] bash: PTY tool one", "[completed] bash: PTY tool two", "Allowed bash once", "Denied edit"]
    cursor = -1
    for text in expected:
        assert transcript.count(text) == 1, (text, transcript, repr(data[-2000:]))
        position = transcript.index(text)
        assert position > cursor, (text, transcript)
        cursor = position
    last_record = f"Stream-{tokens[-1]}" if terminate else "Denied edit"
    assert_cursor_below(data, last_record, height)
    assert data.rfind(b"\r\n") > data.rfind(last_record.encode()), "No final newline below transcript"
    assert data.endswith(b"\r\r\n") or data.endswith(b"\r\n"), "Teardown must leave the cursor on a fresh shell line"
    if storm and not terminate:
        assert storm_count == 100
    print(f"PTY {width}x{height} storm={storm} SIGTERM={terminate}: passed ({len(data) / 20:.1f} bytes/token)")
    return (measurement_end - measurement_start) / 20 if measurement_end else len(data) / 20


inline_bytes = run(80, 24, storm=True)
run(200, 60, storm=True)
run(80, 24, terminate=True)
full_bytes = run(80, 24, full=True, prefix=COMMAND + ["--full"])
print(f"Stream bytes/token: inline={inline_bytes:.1f}, compatible full-screen={full_bytes:.1f} (20 fixture events; no threshold)")
for mux in ["screen", "tmux"]:
    binary = shutil.which(mux)
    if not binary:
        print(f"SKIP {mux}: executable absent")
        continue
    with tempfile.TemporaryDirectory(prefix="ax-inline-mux-") as directory:
        log = str(Path(directory) / "application.bin")
        relay = [sys.executable, str(Path(__file__).resolve()), NODE, "--relay", log]
        if mux == "screen":
            command = [binary, "-q", "-c", "/dev/null", "-S", f"ax-inline-{os.getpid()}"] + relay
        else:
            command = [binary, "-L", f"ax-inline-{os.getpid()}", "-f", "/dev/null", "new-session"] + relay
        try:
            run(80, 24, prefix=command, logfile=log)
            print(f"{mux}: passed")
        except RuntimeError as error:
            print(f"SKIP {mux}: {error}")
