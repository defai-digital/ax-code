import { afterEach, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

async function writeSkill(dir: string, name: string, frontmatter: string, body = "Do the thing.\n") {
  const skillDir = path.join(dir, ".agents", "skills", name)
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(path.join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`)
}

function request(app: ReturnType<typeof Server.Default>, dir: string, route: string, init?: RequestInit) {
  const sep = route.includes("?") ? "&" : "?"
  return app.request(`${route}${sep}directory=${encodeURIComponent(dir)}`, init)
}

test("GET /skill/validate reports standard-compliance issues", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await writeSkill(
        dir,
        "mismatch",
        "name: different-name\ndescription: A skill whose name does not match its directory.",
      )
    },
  })

  const app = Server.Default()
  const response = await request(app, tmp.path, "/skill/validate")
  expect(response.status).toBe(200)
  const report = (await response.json()) as {
    total: number
    invalid: number
    issues: Array<{ name: string; issues: string[] }>
  }

  const offender = report.issues.find((item) => item.name === "different-name")
  expect(offender).toBeDefined()
  expect(offender!.issues).toContain("name should match the parent directory name")
  expect(report.invalid).toBeGreaterThanOrEqual(1)
})

test("GET /skill/doctor surfaces source breakdown and heuristic issues", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await writeSkill(dir, "vague", "name: vague\ndescription: Too short")
    },
  })

  const app = Server.Default()
  const response = await request(app, tmp.path, "/skill/doctor")
  expect(response.status).toBe(200)
  const report = (await response.json()) as {
    sources: Record<string, number>
    issues: Array<{ name: string; issues: string[] }>
  }

  expect(Object.keys(report.sources).length).toBeGreaterThan(0)
  const vague = report.issues.find((item) => item.name === "vague")
  expect(vague?.issues).toContain("description is too vague")
})

test("POST /skill/test-trigger matches skills by path globs", async () => {
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      await writeSkill(
        dir,
        "ts-helper",
        'name: ts-helper\ndescription: Helps with TypeScript source files.\npaths: ["src/**/*.ts"]',
      )
    },
  })

  const app = Server.Default()
  const response = await request(app, tmp.path, "/skill/test-trigger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ files: ["src/index.ts", "README.md"] }),
  })
  expect(response.status).toBe(200)
  const report = (await response.json()) as { files: string[]; matched: Array<{ name: string }> }

  expect(report.files).toEqual(["src/index.ts", "README.md"])
  expect(report.matched.map((m) => m.name)).toContain("ts-helper")
})

test("POST /skill creates a skeleton and rejects duplicates", async () => {
  await using tmp = await tmpdir({ git: true })

  const app = Server.Default()
  const create = () =>
    request(app, tmp.path, "/skill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "release-notes", description: "Draft release notes." }),
    })

  const first = await create()
  expect(first.status).toBe(200)
  const result = (await first.json()) as { path: string }
  expect(result.path).toContain(path.join(".ax-code", "skill", "release-notes", "SKILL.md"))
  expect(await fs.readFile(result.path, "utf8")).toContain("name: release-notes")

  const second = await create()
  expect(second.status).toBe(409)
})

test("POST /skill rejects names that would escape the skill directory", async () => {
  await using tmp = await tmpdir({ git: true })

  const app = Server.Default()
  const response = await request(app, tmp.path, "/skill", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "../../escape", description: "Attempted traversal." }),
  })
  expect(response.status).toBe(400)
})

test("POST /skill rejects absolute paths outside the worktree and home", async () => {
  await using tmp = await tmpdir({ git: true })

  const app = Server.Default()
  const response = await request(app, tmp.path, "/skill", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "evil",
      description: "Attempted arbitrary write.",
      path: "/tmp/ax-code-skill-escape",
    }),
  })
  expect(response.status).toBe(400)
  expect(await Bun.file("/tmp/ax-code-skill-escape/evil/SKILL.md").exists()).toBe(false)
})
