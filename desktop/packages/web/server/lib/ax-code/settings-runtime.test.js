import { describe, expect, it } from "vitest"
import crypto from "crypto"
import fsPromises from "fs/promises"
import os from "os"
import path from "path"
import { createProjectIdFromPath } from "../projects/project-id.js"
import { createSettingsRuntime } from "./settings-runtime.js"

const createRuntime = async () => {
  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "oc-settings-runtime-"))
  const settingsFilePath = path.join(tempRoot, "settings.json")
  const runtime = createSettingsRuntime({
    fsPromises,
    path,
    crypto,
    SETTINGS_FILE_PATH: settingsFilePath,
    sanitizeProjects: (projects) => (Array.isArray(projects) ? projects : []),
    sanitizeSettingsUpdate: (settings) => settings,
    mergePersistedSettings: (_current, changes) => changes,
    normalizeSettingsPaths: (settings) => ({ settings, changed: false }),
    normalizeStringArray: (values) =>
      Array.isArray(values) ? values.filter((value) => typeof value === "string") : [],
    formatSettingsResponse: (settings) => settings,
    resolveDirectoryCandidate: (value) => value,
  })

  return {
    runtime,
    settingsFilePath,
    tempRoot,
    cleanup: async () => {
      await fsPromises.rm(tempRoot, { recursive: true, force: true })
    },
  }
}

describe("settings runtime", () => {
  it("purges disabled remote endpoints and stored credentials during migration", async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime()
    try {
      await fsPromises.writeFile(
        settingsFilePath,
        JSON.stringify({
          themeId: "ax-dark",
          desktopHosts: [{ id: "remote-a", clientToken: "secret-token" }],
          desktopDefaultHostId: "remote-a",
          desktopLocalClientToken: "local-secret",
          desktopSshInstances: [{ id: "ssh-a", auth: { sshPassword: { value: "secret" } } }],
          desktopLanAccessEnabled: true,
          desktopUiPassword: "old-password",
          publicOrigin: "https://remote.example.com",
        }),
        "utf8",
      )

      const migrated = await runtime.readSettingsFromDiskMigrated()
      expect(migrated).toMatchObject({ themeId: "ax-dark" })
      expect(migrated).not.toHaveProperty("desktopHosts")
      expect(migrated).not.toHaveProperty("desktopDefaultHostId")
      expect(migrated).not.toHaveProperty("desktopLocalClientToken")
      expect(migrated).not.toHaveProperty("desktopSshInstances")
      expect(migrated).not.toHaveProperty("desktopLanAccessEnabled")
      expect(migrated).not.toHaveProperty("desktopUiPassword")
      expect(migrated).not.toHaveProperty("publicOrigin")

      await expect(fsPromises.readFile(settingsFilePath, "utf8")).resolves.not.toContain("secret")
    } finally {
      await cleanup()
    }
  })

  it("only remaps project plan paths within the migrated storage directory", async () => {
    const { runtime, settingsFilePath, tempRoot, cleanup } = await createRuntime()
    try {
      const projectPath = path.join(tempRoot, "project")
      const oldProjectId = "legacy-project-id"
      const newProjectId = createProjectIdFromPath(projectPath)
      const projectsRoot = path.join(path.dirname(settingsFilePath), "projects")
      const oldStorageDir = path.join(projectsRoot, oldProjectId)
      const newStorageDir = path.join(projectsRoot, newProjectId)
      const siblingStorageDir = `${oldStorageDir}-sibling`

      await fsPromises.mkdir(projectPath, { recursive: true })
      await fsPromises.mkdir(projectsRoot, { recursive: true })
      await fsPromises.writeFile(
        settingsFilePath,
        JSON.stringify(
          {
            projects: [{ id: oldProjectId, path: projectPath, addedAt: 1, lastOpenedAt: 1 }],
            activeProjectId: oldProjectId,
          },
          null,
          2,
        ),
        "utf8",
      )
      await fsPromises.writeFile(
        path.join(projectsRoot, `${oldProjectId}.json`),
        JSON.stringify(
          {
            "setup-worktree": [" pnpm install ", "", null, "pnpm install"],
            projectTodos: [
              { id: "shared", title: "old shared" },
              { id: "old", title: "old only" },
            ],
            projectPlanFiles: [
              { id: "inside", path: path.join(oldStorageDir, "plans", "inside.md") },
              { id: "sibling", path: path.join(siblingStorageDir, "plans", "outside.md") },
            ],
          },
          null,
          2,
        ),
        "utf8",
      )
      await fsPromises.writeFile(
        path.join(projectsRoot, `${newProjectId}.json`),
        JSON.stringify(
          {
            "setup-worktree": ["npm install", "pnpm install"],
            projectTodos: [
              { id: "new", title: "new only" },
              { id: "shared", title: "new shared" },
            ],
          },
          null,
          2,
        ),
        "utf8",
      )

      await runtime.readSettingsFromDiskMigrated()

      const migratedConfig = JSON.parse(
        await fsPromises.readFile(path.join(projectsRoot, `${newProjectId}.json`), "utf8"),
      )
      expect(migratedConfig["setup-worktree"]).toEqual(["pnpm install", "npm install"])
      expect(migratedConfig.projectTodos).toEqual([
        { id: "new", title: "new only" },
        { id: "shared", title: "new shared" },
        { id: "old", title: "old only" },
      ])
      expect(migratedConfig.projectPlanFiles).toEqual([
        { id: "inside", path: path.join(newStorageDir, "plans", "inside.md") },
        { id: "sibling", path: path.join(siblingStorageDir, "plans", "outside.md") },
      ])
    } finally {
      await cleanup()
    }
  })

  it.skipIf(process.platform !== "win32")("falls back when Windows blocks atomic settings replacement", async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "oc-settings-runtime-"))
    const settingsFilePath = path.join(tempRoot, "settings.json")
    const wrappedFs = {
      ...fsPromises,
      rename: async () => {
        const error = new Error("operation not permitted")
        error.code = "EPERM"
        throw error
      },
    }
    const runtime = createSettingsRuntime({
      fsPromises: wrappedFs,
      path,
      crypto,
      SETTINGS_FILE_PATH: settingsFilePath,
      sanitizeProjects: (projects) => (Array.isArray(projects) ? projects : []),
      sanitizeSettingsUpdate: (settings) => settings,
      mergePersistedSettings: (_current, changes) => changes,
      normalizeSettingsPaths: (settings) => ({ settings, changed: false }),
      normalizeStringArray: (values) =>
        Array.isArray(values) ? values.filter((value) => typeof value === "string") : [],
      formatSettingsResponse: (settings) => settings,
      resolveDirectoryCandidate: (value) => value,
    })

    try {
      await runtime.writeSettingsToDisk({ theme: "dark" })

      await expect(fsPromises.readFile(settingsFilePath, "utf8")).resolves.toBe(
        JSON.stringify({ theme: "dark" }, null, 2),
      )
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("trims legacy theme preferences while migrating light and dark theme ids", async () => {
    const { runtime, settingsFilePath, cleanup } = await createRuntime()
    try {
      await fsPromises.writeFile(
        settingsFilePath,
        JSON.stringify(
          {
            themeId: " automatosx-light ",
            themeVariant: " light ",
          },
          null,
          2,
        ),
        "utf8",
      )

      const settings = await runtime.readSettingsFromDiskMigrated()

      expect(settings).toMatchObject({
        lightThemeId: "automatosx-light",
        darkThemeId: "automatosx-dark",
      })
    } finally {
      await cleanup()
    }
  })
})
