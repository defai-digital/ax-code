import { afterEach, describe, expect, it, vi } from "vitest"
import os from "os"
import path from "path"
import { mkdtemp, readFile, rm, writeFile } from "fs/promises"

import { createProjectConfigRuntime } from "../projects/project-config.js"
import { createScheduledTaskConvergence } from "./convergence.js"

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

const createHarness = async ({ runtimeTasks = [], runtimeHandler } = {}) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "oc-scheduled-convergence-"))
  const projectsDir = path.join(tempRoot, "projects")
  const markerPath = path.join(tempRoot, "scheduled-tasks-migrated.json")
  const projectConfigRuntime = createProjectConfigRuntime({
    fsPromises: await import("fs/promises"),
    path,
    projectsDirPath: projectsDir,
  })

  const requests = []
  const fetchImpl =
    runtimeHandler ||
    (async (url, init = {}) => {
      const method = init.method || "GET"
      requests.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined })
      if (method === "GET") {
        return new Response(JSON.stringify(runtimeTasks), { status: 200 })
      }
      if (method === "POST" && url.includes("/pause")) {
        return new Response(JSON.stringify({ id: "st_x", status: "paused" }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: `st_${requests.length}`, status: "active" }), { status: 200 })
    })

  const convergence = createScheduledTaskConvergence({
    fsPromises: await import("fs/promises"),
    path,
    projectsDirPath: projectsDir,
    markerPath,
    projectConfigRuntime,
    listProjects: async () => [{ id: "proj-a", path: "/work/alpha" }],
    buildAxCodeUrl: () => "http://127.0.0.1:4096/",
    getAxCodeAuthHeaders: () => ({ authorization: "Basic test" }),
    waitForAxCodeReady: async () => {},
    expandSnippets: (prompt) => prompt,
    logger: silentLogger,
    fetchImpl,
  })

  return {
    convergence,
    projectsDir,
    markerPath,
    requests,
    writeProject: async (fileName, data) => {
      await (await import("fs/promises")).mkdir(projectsDir, { recursive: true })
      await writeFile(path.join(projectsDir, fileName), JSON.stringify(data, null, 2), "utf8")
    },
    readProject: async (fileName) => JSON.parse(await readFile(path.join(projectsDir, fileName), "utf8")),
    readMarker: async () => JSON.parse(await readFile(markerPath, "utf8")),
    cleanup: () => rm(tempRoot, { recursive: true, force: true }),
  }
}

const dailyTask = (overrides = {}) => ({
  id: "task-1",
  name: "Digest",
  enabled: true,
  catchUpPolicy: "run_once",
  schedule: { kind: "daily", times: ["09:00"], timezone: "UTC" },
  execution: { prompt: "Summarize", providerID: "openai", modelID: "gpt" },
  state: { createdAt: 1, updatedAt: 2 },
  ...overrides,
})

describe("scheduled task convergence migration", () => {
  let cleanup = async () => {}
  afterEach(async () => {
    await cleanup()
    cleanup = async () => {}
  })

  it("creates runtime tasks, clears the project JSON key, and writes the marker", async () => {
    const harness = await createHarness()
    cleanup = harness.cleanup
    await harness.writeProject("proj-a.json", {
      projectPath: "/work/alpha",
      scheduledTasks: [dailyTask()],
    })

    await harness.convergence.start()

    const creates = harness.requests.filter(
      (request) => request.method === "POST" && request.url.endsWith("/scheduled-task?directory=%2Fwork%2Falpha"),
    )
    expect(creates).toHaveLength(1)
    expect(creates[0].body.title).toBe("Digest")
    expect(creates[0].body.schedule).toEqual({ type: "daily", time: "09:00", timezone: "UTC" })

    const project = await harness.readProject("proj-a.json")
    expect(project.scheduledTasks).toBeUndefined()
    expect(project.projectPath).toBe("/work/alpha")

    const marker = await harness.readMarker()
    expect(typeof marker.migratedAt).toBe("number")
    expect(marker.skipped).toEqual([])
  })

  it("fans out multi-time tasks and pauses disabled ones", async () => {
    const harness = await createHarness()
    cleanup = harness.cleanup
    await harness.writeProject("proj-a.json", {
      projectPath: "/work/alpha",
      scheduledTasks: [
        dailyTask({ name: "Multi", schedule: { kind: "daily", times: ["09:00", "18:00"], timezone: "UTC" } }),
        dailyTask({ id: "task-2", name: "Paused", enabled: false }),
      ],
    })

    await harness.convergence.start()

    const titles = harness.requests
      .filter((request) => request.method === "POST" && request.body?.title)
      .map((request) => request.body.title)
    expect(titles).toEqual(["Multi (1/2)", "Multi (2/2)", "Paused"])
    const pauses = harness.requests.filter((request) => request.url.includes("/pause"))
    expect(pauses).toHaveLength(1)

    const project = await harness.readProject("proj-a.json")
    expect(project.scheduledTasks).toBeUndefined()
  })

  it("is idempotent: titles already present in the runtime are not re-created", async () => {
    const harness = await createHarness({
      runtimeTasks: [{ id: "st_existing", title: "Digest", status: "active" }],
    })
    cleanup = harness.cleanup
    await harness.writeProject("proj-a.json", {
      projectPath: "/work/alpha",
      scheduledTasks: [dailyTask()],
    })

    await harness.convergence.start()

    const creates = harness.requests.filter((request) => request.method === "POST" && request.body?.title)
    expect(creates).toHaveLength(0)
    const project = await harness.readProject("proj-a.json")
    expect(project.scheduledTasks).toBeUndefined()
    const marker = await harness.readMarker()
    expect(typeof marker.migratedAt).toBe("number")
  })

  it("records permanent skips (unsupported cron, slash commands) and still finalizes", async () => {
    const harness = await createHarness()
    cleanup = harness.cleanup
    await harness.writeProject("proj-a.json", {
      projectPath: "/work/alpha",
      scheduledTasks: [
        dailyTask({ id: "task-cron", name: "Cron", schedule: { kind: "cron", cron: "0 9 * * MON", timezone: "UTC" } }),
        dailyTask({ id: "task-cmd", name: "Cmd", execution: { prompt: "/review", providerID: "o", modelID: "m" } }),
        dailyTask({ id: "task-ok", name: "Ok" }),
      ],
    })

    await harness.convergence.start()

    const marker = await harness.readMarker()
    expect(typeof marker.migratedAt).toBe("number")
    expect(marker.skipped).toHaveLength(2)
    expect(marker.skipped.map((entry) => entry.task).sort()).toEqual(["Cmd", "Cron"])
    const project = await harness.readProject("proj-a.json")
    expect(project.scheduledTasks).toBeUndefined()
  })

  it("keeps retryable tasks in the project JSON and writes a progress marker", async () => {
    let postCount = 0
    const harness = await createHarness({
      runtimeHandler: async (url, init = {}) => {
        const method = init.method || "GET"
        if (method === "GET") {
          return new Response(JSON.stringify([]), { status: 200 })
        }
        postCount += 1
        return new Response("boom", { status: 500 })
      },
    })
    cleanup = harness.cleanup
    await harness.writeProject("proj-a.json", {
      projectPath: "/work/alpha",
      scheduledTasks: [dailyTask()],
    })

    await harness.convergence.start()
    expect(postCount).toBeGreaterThan(0)

    const project = await harness.readProject("proj-a.json")
    expect(project.scheduledTasks).toHaveLength(1)

    const marker = await harness.readMarker()
    expect(marker.migratedAt).toBeUndefined()
    expect(marker.attempts).toBe(1)
  })

  it("skips migration entirely once the marker is finalized, but still wakes directories", async () => {
    const harness = await createHarness()
    cleanup = harness.cleanup
    await harness.writeProject("proj-a.json", {
      projectPath: "/work/alpha",
      scheduledTasks: [dailyTask()],
    })
    await writeFile(
      harness.markerPath,
      JSON.stringify({ migratedAt: Date.now(), attempts: 1, skipped: [], warnings: [] }),
      "utf8",
    )

    await harness.convergence.start()

    // One GET for the wake-up, zero POSTs, and the project JSON is untouched.
    expect(harness.requests.filter((request) => request.method === "POST")).toHaveLength(0)
    expect(harness.requests.filter((request) => request.method === "GET")).toHaveLength(1)
    const project = await harness.readProject("proj-a.json")
    expect(project.scheduledTasks).toHaveLength(1)
  })

  it("does not touch the marker when the runtime is not ready", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "oc-scheduled-convergence-notready-"))
    cleanup = () => rm(tempRoot, { recursive: true, force: true })
    const convergence = createScheduledTaskConvergence({
      fsPromises: await import("fs/promises"),
      path,
      projectsDirPath: path.join(tempRoot, "projects"),
      markerPath: path.join(tempRoot, "scheduled-tasks-migrated.json"),
      projectConfigRuntime: { replaceScheduledTasks: async () => ({ tasks: [] }) },
      listProjects: async () => [],
      buildAxCodeUrl: () => "http://127.0.0.1:4096/",
      getAxCodeAuthHeaders: () => ({}),
      waitForAxCodeReady: async () => {
        throw new Error("not ready")
      },
      expandSnippets: (prompt) => prompt,
      logger: silentLogger,
      fetchImpl: vi.fn(),
    })

    await convergence.start()
    await expect(readFile(path.join(tempRoot, "scheduled-tasks-migrated.json"), "utf8")).rejects.toThrow()
  })

  it("wakes every registered project directory once", async () => {
    const harness = await createHarness()
    cleanup = harness.cleanup
    await harness.convergence.wakeUp()
    const gets = harness.requests.filter((request) => request.method === "GET")
    expect(gets).toHaveLength(1)
    expect(gets[0].url).toContain("/scheduled-task")
    expect(gets[0].url).toContain("directory=%2Fwork%2Falpha")
  })
})
