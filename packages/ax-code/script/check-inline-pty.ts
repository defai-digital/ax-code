// Python's standard-library PTY keeps this check independent of node-pty binaries.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const temporary = mkdtempSync(path.join(os.tmpdir(), "ax-inline-measure-"))
// AX_CODE_TEST_HOME makes Global.Path.state use .local/state, overriding XDG.
// The legacy fixture's KV file therefore never disabled startup animations.
// Use an adapted temporary copy because this check also needs enough transcript
// viewport at 24 rows: hide optional header/navigation/sidebar in BOTH profiles.
// Events, dimensions, input, token pacing and final drain remain identical.
let fixture = readFileSync(new URL("inline-pty-fixture.tsx", import.meta.url), "utf8")
function replaceFixture(before: string, after: string) {
  if (!fixture.includes(before)) throw new Error(`PTY fixture contract changed: ${before}`)
  fixture = fixture.replace(before, after)
}
replaceFixture('path.join(process.env.XDG_STATE_HOME!, "ax-code")', 'path.join(state, ".local", "state", "ax-code")')
replaceFixture(
  "animations_enabled: false,",
  'animations_enabled: false, header_visible: false, navigation_visible: false, sidebar: "hide",',
)
// Load the lazy session route outside the measured window for both profiles.
replaceFixture("if (fullScreen) {", 'await import("../src/cli/tui/routes/session/index.tsx")\nif (fullScreen) {')
fixture = fixture
  .replaceAll("import.meta.dirname", JSON.stringify(path.join(packageRoot, "script")))
  .replace(/(["'])\.\.\/src\/([^"']+)\1/g, (_match, _quote, suffix: string) =>
    JSON.stringify(path.join(packageRoot, "src", suffix)),
  )
writeFileSync(path.join(temporary, "package.json"), '{"type":"module"}')
symlinkSync(path.join(packageRoot, "node_modules"), path.join(temporary, "node_modules"), "dir")
writeFileSync(path.join(temporary, "fixture.tsx"), fixture)

// Reuse the driver's fixtures, terminal checks and multiplexer coverage, but
// replace its legacy entry point: that compared a resizing inline terminal to
// a non-resizing full-screen terminal. Keep this orchestration here so both
// profiles always receive the same scenario options.
const check = String.raw`
import ast
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import sys

filename = sys.argv[2]
__file__ = filename
module = ast.parse(Path(filename).read_text(), filename)
entry = next(i for i, node in enumerate(module.body)
             if isinstance(node, ast.Assign)
             and any(isinstance(target, ast.Name) and target.id == "inline_bytes" for target in node.targets))
# Reject a comparison against animation-only or fully clipped transcript output.
driver = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == "run")
# Resize pacing must not depend on how often application output wakes select().
# Deliver the same 100 alternating widths at 10 ms intervals in both runs.
storm = next(node for node in ast.walk(driver) if isinstance(node, ast.If)
             and ast.unparse(node.test) == "storm and storm_count < 100")
storm.test = ast.parse("storm and storm_count < 100 and "
                       "time.monotonic() - stream_start >= storm_count * .01", mode="eval").body
full = next(node for node in driver.body if isinstance(node, ast.If)
            and isinstance(node.test, ast.Name) and node.test.id == "full")
full.body.insert(-1, ast.parse('assert b"Stream-" in data[measurement_start:measurement_end] and '
                             'b"pty_code" in data[measurement_start:measurement_end], '
                             '"Full-screen stream was not visible during measurement"').body[0])
exec(compile(ast.Module(body=module.body[:entry], type_ignores=[]), filename, "exec"))
COMMAND[-1] = sys.argv[3]

driver_run = run
def run(*args, **kwargs):
    output = StringIO()
    with redirect_stdout(output):
        result = driver_run(*args, **kwargs)
    # The driver's diagnostic includes startup/decisions/teardown and divides
    # by 20 even for SIGTERM. Distinguish it from the stream-only measurement.
    print(output.getvalue().replace("bytes/token", "session bytes / 20 scheduled events"), end="", flush=True)
    return result

for width, height, storm in [(80, 24, False), (200, 60, False), (80, 24, True), (200, 60, True)]:
    inline_bytes = run(width, height, storm=storm)
    full_bytes = run(width, height, storm=storm, full=True, prefix=COMMAND + ["--full"])
    print(f"Stream bytes/token {width}x{height} storm={storm}: inline={inline_bytes:.1f}, "
          f"compatible full-screen={full_bytes:.1f}; inline lower={inline_bytes < full_bytes} "
          "(same 20 fixture events at 70 ms; stream markers only)", flush=True)
run(80, 24, terminate=True)

# Keep the original optional screen/tmux checks, including relay startup.
for node in module.body[entry:]:
    if isinstance(node, ast.For) and isinstance(node.target, ast.Name) and node.target.id == "mux":
        exec(compile(ast.Module(body=[node], type_ignores=[]), filename, "exec"))
`
try {
  const result = spawnSync(
    "python3",
    [
      "-c",
      check,
      process.execPath,
      fileURLToPath(new URL("inline-pty.py", import.meta.url)),
      path.join(temporary, "fixture.tsx"),
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  )
  process.stdout.write(result.stdout ?? "")
  process.stderr.write(result.stderr ?? "")
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = 1
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
