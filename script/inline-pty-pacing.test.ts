import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

test("the PTY resize storm catches up after delayed polls without sending future or extra events", () => {
  const source = readFileSync(new URL("../packages/ax-code/script/check-inline-pty.ts", import.meta.url), "utf8")
  const pacing = source.slice(source.indexOf("storm = next("), source.indexOf("full = next("))
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import ast, sys
from types import SimpleNamespace
module = ast.parse('''
def run(wakeups):
    storm = True
    storm_count = 0
    stream_start = 0
    sent = []
    for now in wakeups:
        clock[0] = now
        if storm and storm_count < 100:
            sent.append(storm_count)
            storm_count += 1
    return sent
''')
driver = module.body[0]
exec(sys.stdin.read())
clock = [0]
namespace = dict(clock=clock, time=SimpleNamespace(monotonic=lambda: clock[0]))
exec(compile(module, '<actual-pty-pacing>', 'exec'), namespace)
run = namespace['run']
assert run([0, .3, .6, .9, 1.2, 1.4]) == list(range(100))
assert run([0, .001, .002]) == [0]
assert run([0, 2, 3]) == list(range(100))
`,
    ],
    { input: pacing, encoding: "utf8" },
  )
  expect(result.error).toBeUndefined()
  expect(result.stderr).toBe("")
  expect(result.status).toBe(0)
})
