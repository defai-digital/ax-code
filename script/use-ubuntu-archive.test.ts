import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { expect, test } from "vitest"
import { usePrimaryUbuntuArchive } from "../.github/scripts/use-ubuntu-archive"

const regional = "http://us-east-2.ec2.archive.ubuntu.com/ubuntu"
const primary = "https://archive.ubuntu.com/ubuntu"
const helper = fileURLToPath(new URL("../.github/scripts/use-ubuntu-archive.ts", import.meta.url))

function sources(uri: string): string {
  return `Types: deb\nURIs: ${uri}\nSuites: noble noble-updates noble-backports\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n`
}

test("replaces active deb822 mirror URIs while preserving signing settings and comments", () => {
  const before = `# Keep ${regional}\n${sources(regional)}`
  expect(usePrimaryUbuntuArchive(before, "sources")).toBe(`# Keep ${regional}\n${sources(primary)}`)
})

test("handles continued URI lists without changing line endings or other repositories", () => {
  const before = `Types: deb\r\nURIs:\r\n ${regional}/\r\n https://packages.example/ubuntu\r\nSuites: noble\r\n`
  expect(usePrimaryUbuntuArchive(before, "sources")).toBe(
    `Types: deb\r\nURIs:\r\n ${primary}/\r\n https://packages.example/ubuntu\r\nSuites: noble\r\n`,
  )
})

test("changes only the repository URI in active legacy source lines", () => {
  const before = `# deb ${regional} noble main\ndeb [arch=amd64 signed-by=/keyring.gpg] ${regional} noble main # ${regional}\ndeb-src ${regional}/ noble main\n`
  expect(usePrimaryUbuntuArchive(before, "list")).toBe(
    `# deb ${regional} noble main\ndeb [arch=amd64 signed-by=/keyring.gpg] ${primary} noble main # ${regional}\ndeb-src ${primary}/ noble main\n`,
  )
})

test("normalizes mirror-list targets while preserving priorities, restrictions, comments, and CRLF", () => {
  const before = `# ${regional}\r\n${regional}\tpriority:1 arch:amd64\r\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\r\n`
  expect(usePrimaryUbuntuArchive(before, "mirrors")).toBe(
    `# ${regional}\r\n${primary}\tpriority:1 arch:amd64\r\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\r\n`,
  )
  const indirection = sources("mirror+file:/etc/apt/apt-mirrors.txt")
  expect(usePrimaryUbuntuArchive(indirection, "sources")).toBe(indirection)
})

test.each([
  "https://packages.example/ubuntu",
  "http://us-east-2.ec2.archive.ubuntu.com.example/ubuntu",
  "http://user:password@us-east-2.ec2.archive.ubuntu.com/ubuntu",
  "http://us-east-2.ec2.archive.ubuntu.com:8080/ubuntu",
  "http://us-east-2.ec2.archive.ubuntu.com/other",
  `${regional}?token=fixture`,
  `${regional}#fragment`,
  "http://security.ubuntu.com/ubuntu",
  "http://archive.ubuntu.com/ubuntu",
])("preserves non-target or customized repository URI %s", (uri) => {
  expect(usePrimaryUbuntuArchive(sources(uri), "sources")).toBe(sources(uri))
  expect(usePrimaryUbuntuArchive(`${uri}\tpriority:1\n`, "mirrors")).toBe(`${uri}\tpriority:1\n`)
})

test("repeated source normalization is unchanged", () => {
  const once = usePrimaryUbuntuArchive(sources(regional), "sources")
  expect(usePrimaryUbuntuArchive(once, "sources")).toBe(once)
})

test("the CLI rewrites only supplied source fixtures and retains file permissions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-ubuntu-archive-"))
  try {
    const file = path.join(directory, "ubuntu.sources")
    const missing = path.join(directory, "missing.list")
    await fs.writeFile(file, sources(regional), { mode: 0o600 })
    const mode = (await fs.stat(file)).mode
    await promisify(execFile)(process.execPath, ["--import", "tsx", helper, file, missing])
    expect(await fs.readFile(file, "utf8")).toBe(sources(primary))
    expect((await fs.stat(file)).mode).toBe(mode)
    await expect(fs.stat(missing)).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("the CLI rejects a non-APT target without changing it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-ubuntu-archive-"))
  try {
    const file = path.join(directory, "keep.txt")
    await fs.writeFile(file, sources(regional))
    await expect(promisify(execFile)(process.execPath, ["--import", "tsx", helper, file])).rejects.toThrow(
      "Expected an absolute APT .sources, .list, or apt-mirrors.txt path",
    )
    expect(await fs.readFile(file, "utf8")).toBe(sources(regional))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("the CLI rewrites the runner mirror list instead of changing its source indirection", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ax-code-ubuntu-mirrorlist-"))
  try {
    const source = path.join(directory, "ubuntu.sources")
    const mirror = path.join(directory, "apt-mirrors.txt")
    const indirection = sources("mirror+file:/etc/apt/apt-mirrors.txt")
    await fs.writeFile(source, indirection)
    await fs.writeFile(mirror, `${regional}\tpriority:1\nhttp://archive.ubuntu.com/ubuntu/\tpriority:2\n`)
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", helper, source, mirror])
    expect(await fs.readFile(source, "utf8")).toBe(indirection)
    expect(await fs.readFile(mirror, "utf8")).toBe(
      `${primary}\tpriority:1\nhttp://archive.ubuntu.com/ubuntu/\tpriority:2\n`,
    )
    expect(stdout).toContain(`Use primary Ubuntu archive: ${mirror}`)
    expect(stdout).toContain(`No regional EC2 archive to replace: ${source}`)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("browser dependency installation follows mirror normalization with the pinned Node executable", async () => {
  const workflow = await fs.readFile(new URL("../.github/workflows/ax-code-ci.yml", import.meta.url), "utf8")
  const setup = 'sudo -- "$(command -v node)" --import tsx .github/scripts/use-ubuntu-archive.ts'
  expect(workflow).toContain(setup)
  expect(workflow.indexOf(setup)).toBeLessThan(
    workflow.indexOf("pnpm --dir packages/ax-code-diff-wasm exec playwright-core install --with-deps"),
  )
})
