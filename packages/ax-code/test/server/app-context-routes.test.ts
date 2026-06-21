import { expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Server } from "../../src/server/server"
import { contextChecks } from "../../src/server/routes/app-context-checks"
import { tmpdir } from "../fixture/fixture"

function directoryUrl(route: string, directory: string) {
  return `${route}?directory=${encodeURIComponent(directory)}`
}

test("GET /context returns project context metadata", async () => {
  await using tmp = await tmpdir({ git: true })
  await Bun.write(
    path.join(tmp.path, "package.json"),
    JSON.stringify({
      scripts: {
        typecheck: "tsc --noEmit",
      },
    }),
  )

  const response = await Server.Default().request(directoryUrl("/context", tmp.path))
  expect(response.status).toBe(200)

  const payload = (await response.json()) as {
    directory?: string
    worktree?: string
    files?: Array<{ name: string; exists: boolean }>
    templates?: Array<{ key: string; path: string; exists: boolean }>
    checks?: Array<{ title: string; command: string }>
  }

  expect(payload.directory).toBe(tmp.path)
  expect(payload.worktree).toBe(tmp.path)
  expect(payload.files?.some((file) => file.name === "AGENTS.md")).toBe(true)
  expect(payload.files?.some((file) => file.name === "CLAUDE.md")).toBe(true)
  expect(payload.files?.some((file) => file.name === "AX.md")).toBe(false)
  expect(payload.templates?.some((template) => template.key === "repo-rules")).toBe(true)
  expect(payload.checks?.some((check) => check.command === "npm run typecheck")).toBe(true)
})

test("GET /context ignores non-string package scripts", async () => {
  await using tmp = await tmpdir({ git: true })
  await Bun.write(
    path.join(tmp.path, "package.json"),
    JSON.stringify({
      scripts: {
        typecheck: true,
        test: false,
        lint: "eslint .",
      },
    }),
  )

  const response = await Server.Default().request(directoryUrl("/context", tmp.path))
  expect(response.status).toBe(200)

  const payload = (await response.json()) as {
    checks?: Array<{ title: string; command: string }>
  }

  expect(payload.checks?.some((check) => check.command === "npm run typecheck")).toBe(false)
  expect(payload.checks?.some((check) => check.command === "npm run test")).toBe(false)
  expect(payload.checks?.some((check) => check.command === "npm run lint")).toBe(true)
})

test("context checks surface unreadable package.json files", async () => {
  if (process.platform === "win32") return

  await using tmp = await tmpdir({ git: true })
  const pkg = path.join(tmp.path, "package.json")
  await Bun.write(pkg, JSON.stringify({ scripts: { test: "vitest run" } }))
  await fs.chmod(pkg, 0)

  try {
    await expect(contextChecks({ root: tmp.path, dir: tmp.path })).rejects.toMatchObject({ code: "EACCES" })
  } finally {
    await fs.chmod(pkg, 0o600)
  }
})

test("context checks surface unreadable Makefiles", async () => {
  if (process.platform === "win32") return

  await using tmp = await tmpdir({ git: true })
  const makefile = path.join(tmp.path, "Makefile")
  await Bun.write(makefile, "test:\n\techo test\n")
  await fs.chmod(makefile, 0)

  try {
    await expect(contextChecks({ root: tmp.path, dir: tmp.path })).rejects.toMatchObject({ code: "EACCES" })
  } finally {
    await fs.chmod(makefile, 0o600)
  }
})

test("POST /context/template creates the requested context template", async () => {
  await using tmp = await tmpdir({ git: true })

  const response = await Server.Default().request(directoryUrl("/context/template", tmp.path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ key: "repo-rules" }),
  })
  expect(response.status).toBe(200)

  const payload = (await response.json()) as { key?: string; path?: string; exists?: boolean }
  const expectedPath = path.join(tmp.path, "AGENTS.md")
  expect(payload).toMatchObject({
    key: "repo-rules",
    path: expectedPath,
    exists: true,
  })
  expect(await Bun.file(expectedPath).text()).toContain("# Project Instructions")
})
