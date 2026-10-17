import { expect, test } from "vitest"
import { shouldAutoAccept } from "../../src/permission/auto-accept"
import { SafetyPolicy } from "../../src/control-plane/safety-policy"

const decide = (input: Parameters<typeof SafetyPolicy.decide>[0]) => SafetyPolicy.decide(input)
const request = (command: string) => ({
  enabled: true,
  permission: "bash",
  patterns: [command],
  directory: "/project",
  metadata: { bashCommand: command, bashCwd: "/project" },
  decide,
})

test.each([
  'python3 -c \'open(".env","w").write("x")\'',
  'node -e \'require("fs").writeFileSync(".env","x")\'',
  "perl -e 'open(F,\">.env\")'",
  "bash -c 'echo x > .env'",
  "pnpm test",
  "python script.py",
  "sh script.sh",
  "env ls",
  "sudo ls",
  "xargs touch",
  "eval ls",
  "source script.sh",
  "curl example.com",
  "wget example.com",
  "tee output",
  "ls && node -e 'code'",
  "cat src/file > .env",
  "echo hi > .git/HEAD",
  "ls > $OUTPUT",
  "echo $(pwd)",
  "echo `pwd`",
  "touch *.pem",
  "git -C /outside status",
  "git diff --output=.env",
  "sort -o.env src/file",
  "git --config-env=alias.foo=VAR foo",
  "ls'evil'",
  "echo hi;ls'evil'",
  "cp --target-directory=.git source",
  "mkdir ../outside",
  "cat /outside/file",
  "ls & touch src/file",
])("opaque or unresolved bash keeps its prompt: %s", (command) => {
  expect(shouldAutoAccept(request(command))).toBe(false)
})

test.each([
  "ls",
  "ls -la",
  "cat src/file",
  "wc src/file",
  "head src/file",
  "grep needle src/file",
  "ls && cat src/file",
])("known commands with project-local targets qualify: %s", (command) => {
  expect(shouldAutoAccept(request(command))).toBe(true)
})

test.each([
  "git commit -m 'Update source'",
  "git switch feature",
  "git checkout feature",
  "git restore src/file",
  "git stash",
  "git merge feature",
  "git rebase main",
])("git subcommands that can run repository hooks keep the prompt: %s", (command) => {
  expect(shouldAutoAccept(request(command))).toBe(false)
})

test.each([
  "git -ccore.fsmonitor=./payload status",
  "git --git-dir=/outside/.git status",
  "git -C/outside status",
  "git -C /outside status",
  "git --work-tree=/outside status",
  "cp -R template target",
  "cp src/file src/other",
  "mv src/file src/other",
  "mv stage live && cp payload live/key",
  "mkdir src/new && touch src/new/file",
  "echo hi > src/output && cat src/output",
  "ls && git add src/file",
])("globals, copies/moves and compound writes keep the prompt: %s", (command) => {
  expect(shouldAutoAccept(request(command))).toBe(false)
})

test("a compound of read-only commands still qualifies", () => {
  expect(shouldAutoAccept(request("ls && cat src/file"))).toBe(true)
  expect(shouldAutoAccept(request("ls | wc"))).toBe(true)
  expect(shouldAutoAccept(request("mkdir -p src/new"))).toBe(false)
})

test("missing, oversized, or non-project command metadata never grants approval", () => {
  expect(shouldAutoAccept({ ...request("ls"), metadata: {} })).toBe(false)
  expect(shouldAutoAccept(request("echo " + "x".repeat(4096)))).toBe(false)
  expect(shouldAutoAccept({ ...request("ls"), metadata: { bashCommand: "ls", bashCwd: "/outside" } })).toBe(false)
})

// Even branch creation can invoke reference-transaction hooks controlled by the repository.
test.each([
  "mkdir src/new",
  "mkdir -p src/new",
  "touch src/file",
  "git add src/file",
  "git branch feature",
  "git branch",
  "git branch --list",
  "echo hi > src/output",
  "echo hi >> src/output",
  "cat src/file > /dev/null",
  "git alias-name",
  "git log --unknown",
])("all mutators and non-allowlisted git commands keep the prompt: %s", (command) => {
  expect(shouldAutoAccept(request(command))).toBe(false)
})

test.each([
  "git status",
  "git diff",
  "git log",
  "git show",
  "uniq src/input.txt src/output.txt",
  "sort -o src/out src/in",
  "cut -f1 src/file",
  "cat link/../public.txt",
  "cat ../outside.txt",
  "ls ..",
  "cat src/../src/file",
])("git, output-taking filters and parent references keep the prompt: %s", (command) => {
  expect(shouldAutoAccept(request(command))).toBe(false)
})

test.each([
  "grep -r needle src",
  "grep -R needle src",
  "grep -rn needle src",
  "rg needle src/file",
  "rg --hidden needle src",
  "ls -R",
  "ls -R src",
  "tail -r src/file",
])("recursive search/listing options and rg keep the prompt: %s", (command) => {
  expect(shouldAutoAccept(request(command))).toBe(false)
})
