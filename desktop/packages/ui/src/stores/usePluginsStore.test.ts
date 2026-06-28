import { beforeEach, describe, expect, test, vi } from "vitest"

import type { PluginEntry, PluginFile, RegistryResult } from "./usePluginsStore"
import { API_ENDPOINTS } from "@/lib/http"

let activeProjectPath = "/workspace/project"

const refreshAfterAxCodeRestartMock = vi.fn(async () => undefined)
const startConfigUpdateMock = vi.fn(() => undefined)
const finishConfigUpdateMock = vi.fn(() => undefined)

vi.doMock("@/stores/useProjectsStore", () => ({
  useProjectsStore: {
    getState: () => ({
      getActiveProject: () => ({ path: activeProjectPath }),
    }),
  },
}))

vi.doMock("@/lib/ax-code/client", () => ({
  axCodeClient: {
    getDirectory: () => "/fallback/project",
  },
}))

vi.doMock("@/stores/useAgentsStore", () => ({
  refreshAfterAxCodeRestart: refreshAfterAxCodeRestartMock,
  filterVisibleAgents: (agents: unknown[]) => agents,
}))

vi.doMock("@/lib/configUpdate", () => ({
  startConfigUpdate: startConfigUpdateMock,
  finishConfigUpdate: finishConfigUpdateMock,
  updateConfigUpdateMessage: vi.fn(() => undefined),
  subscribeConfigUpdate: vi.fn(() => () => undefined),
  getConfigUpdateSnapshot: vi.fn(() => ({ isUpdating: false, message: null })),
}))

const { usePluginsStore } = await import("./usePluginsStore")

const entry: PluginEntry = {
  id: "config:user:plugin-a",
  spec: "plugin-a",
  scope: "user",
  kind: "config",
  parsedKind: "npm",
}

const file: PluginFile = {
  id: "file:user:plugin.ts",
  fileName: "plugin.ts",
  scope: "user",
  kind: "file",
}

const pluginListPayload = {
  entries: [entry],
  files: [file],
}

const okMutationPayload = {
  success: true,
  requiresReload: false,
  message: "ok",
  reloadDelayMs: 800,
  reloadFailed: false,
}

const registryOk: RegistryResult = {
  kind: "npm-ok",
  spec: "plugin-a",
  name: "plugin-a",
  currentVersion: null,
  latestVersion: "1.0.0",
  versions: ["1.0.0"],
  hasUpdate: false,
}

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })

type PluginRegistryFetchCall = {
  input: RequestInfo | URL
  init?: RequestInit
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const fetchCalls: PluginRegistryFetchCall[] = []
let queuedResponses: Array<Response | Promise<Response>> = []

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  fetchCalls.push({ input, init })
  return queuedResponses.shift() ?? jsonResponse(pluginListPayload)
})

const queueFetchResponses = (responses: Array<Response | Promise<Response>>) => {
  queuedResponses = [...responses]
}

const resetStore = () => {
  usePluginsStore.setState({
    entries: [],
    files: [],
    selectedId: null,
    isLoading: false,
    registryInfo: {},
    isLoadingRegistry: false,
    draft: null,
  })
}

const registryCalls = (): PluginRegistryFetchCall[] =>
  fetchCalls.filter((call) => String(call.input).includes(API_ENDPOINTS.config.pluginRegistry))

const requestBody = (callIndex: number): unknown => {
  const init = fetchCalls[callIndex]?.init
  return init?.body ? JSON.parse(String(init.body)) : undefined
}

describe("usePluginsStore", () => {
  beforeEach(() => {
    activeProjectPath = "/workspace/project"
    resetStore()
    fetchCalls.length = 0
    queuedResponses = []
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  test("loadPlugins calls config plugins endpoint once and populates entries/files", async () => {
    queueFetchResponses([jsonResponse(pluginListPayload), jsonResponse({ results: [registryOk] })])

    const result = await usePluginsStore.getState().loadPlugins()

    expect(result).toBe(true)
    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[0]?.input).toBe("/api/config/plugins?directory=%2Fworkspace%2Fproject")
    expect(usePluginsStore.getState().entries).toEqual([entry])
    expect(usePluginsStore.getState().files).toEqual([file])
    expect(usePluginsStore.getState().isLoading).toBe(false)
  })

  test("second loadPlugins within TTL reuses cached store data", async () => {
    queueFetchResponses([jsonResponse(pluginListPayload), jsonResponse({ results: [registryOk] })])

    await usePluginsStore.getState().loadPlugins()
    await usePluginsStore.getState().loadPlugins()

    expect(fetchCalls).toHaveLength(2)
  })

  test("force loadPlugins bypasses TTL cache", async () => {
    queueFetchResponses([
      jsonResponse(pluginListPayload),
      jsonResponse({ results: [registryOk] }),
      jsonResponse(pluginListPayload),
    ])

    await usePluginsStore.getState().loadPlugins()
    await usePluginsStore.getState().loadPlugins({ force: true })

    expect(fetchCalls).toHaveLength(3)
  })

  test("keeps the newest forced plugin list when refreshes overlap", async () => {
    const staleRefresh = createDeferred<Response>()
    const latestRefresh = createDeferred<Response>()
    const staleEntry: PluginEntry = { ...entry, id: "config:user:stale-plugin", spec: "stale-plugin" }
    const latestEntry: PluginEntry = { ...entry, id: "config:user:latest-plugin", spec: "latest-plugin" }
    queueFetchResponses([staleRefresh.promise, latestRefresh.promise])

    const firstLoad = usePluginsStore.getState().loadPlugins({ force: true })
    const secondLoad = usePluginsStore.getState().loadPlugins({ force: true })
    await Promise.resolve()

    latestRefresh.resolve(jsonResponse({ entries: [latestEntry], files: [] }))
    await secondLoad

    staleRefresh.resolve(jsonResponse({ entries: [staleEntry], files: [] }))
    await firstLoad

    expect(fetchCalls).toHaveLength(2)
    expect(usePluginsStore.getState().entries).toEqual([latestEntry])
    expect(usePluginsStore.getState().files).toEqual([])
    expect(usePluginsStore.getState().isLoading).toBe(false)
  })

  test("keeps the newest plugin list after switching project directories", async () => {
    const staleRefresh = createDeferred<Response>()
    const latestRefresh = createDeferred<Response>()
    const staleEntry: PluginEntry = { ...entry, id: "config:user:old-project-plugin", spec: "old-project-plugin" }
    const latestEntry: PluginEntry = { ...entry, id: "config:user:new-project-plugin", spec: "new-project-plugin" }
    queueFetchResponses([staleRefresh.promise, latestRefresh.promise])

    activeProjectPath = "/workspace/old-project"
    const oldLoad = usePluginsStore.getState().loadPlugins({ force: true })
    activeProjectPath = "/workspace/new-project"
    const newLoad = usePluginsStore.getState().loadPlugins({ force: true })
    await Promise.resolve()

    latestRefresh.resolve(jsonResponse({ entries: [latestEntry], files: [] }))
    await newLoad

    staleRefresh.resolve(jsonResponse({ entries: [staleEntry], files: [] }))
    await oldLoad

    expect(fetchCalls.map((call) => call.input)).toEqual([
      "/api/config/plugins?directory=%2Fworkspace%2Fold-project",
      "/api/config/plugins?directory=%2Fworkspace%2Fnew-project",
    ])
    expect(usePluginsStore.getState().entries).toEqual([latestEntry])
    expect(usePluginsStore.getState().files).toEqual([])
    expect(usePluginsStore.getState().isLoading).toBe(false)
  })

  test("createEntry posts spec and scope in request body", async () => {
    queueFetchResponses([jsonResponse(okMutationPayload), jsonResponse(pluginListPayload)])

    const result = await usePluginsStore.getState().createEntry({ spec: "a", scope: "user" })

    expect(result.ok).toBe(true)
    expect(fetchCalls[0]?.input).toBe("/api/config/plugins/entry?directory=%2Fworkspace%2Fproject")
    expect(fetchCalls[0]?.init?.method).toBe("POST")
    expect(requestBody(0)).toEqual({ spec: "a", scope: "user" })
  })

  test("createEntry includes options when provided", async () => {
    queueFetchResponses([jsonResponse(okMutationPayload), jsonResponse(pluginListPayload)])

    await usePluginsStore.getState().createEntry({ spec: "a", options: { enabled: true }, scope: "project" })

    expect(requestBody(0)).toEqual({ spec: "a", options: { enabled: true }, scope: "project" })
  })

  test("updateEntry patches entry id path", async () => {
    queueFetchResponses([jsonResponse(okMutationPayload), jsonResponse(pluginListPayload)])

    const result = await usePluginsStore.getState().updateEntry("entry-id", { spec: "b" })

    expect(result.ok).toBe(true)
    expect(fetchCalls[0]?.input).toBe("/api/config/plugins/entry/entry-id?directory=%2Fworkspace%2Fproject")
    expect(fetchCalls[0]?.init?.method).toBe("PATCH")
    expect(requestBody(0)).toEqual({ spec: "b" })
  })

  test("deleteEntry deletes entry id, invalidates cache, reloads, and clears selected id", async () => {
    queueFetchResponses([
      jsonResponse(pluginListPayload),
      jsonResponse({ results: [registryOk] }),
      jsonResponse(okMutationPayload),
      jsonResponse({ entries: [], files: [file] }),
    ])
    await usePluginsStore.getState().loadPlugins()
    usePluginsStore.getState().setSelected(entry.id)

    const result = await usePluginsStore.getState().deleteEntry(entry.id)

    expect(result.ok).toBe(true)
    expect(fetchCalls[2]?.input).toBe(
      `/api/config/plugins/entry/${encodeURIComponent(entry.id)}?directory=%2Fworkspace%2Fproject`,
    )
    expect(fetchCalls[2]?.init?.method).toBe("DELETE")
    expect(fetchCalls[3]?.input).toBe("/api/config/plugins?directory=%2Fworkspace%2Fproject")
    expect(usePluginsStore.getState().entries).toEqual([])
    expect(usePluginsStore.getState().selectedId).toBeNull()
  })

  test("createFile posts file name, content, and scope", async () => {
    queueFetchResponses([jsonResponse(okMutationPayload), jsonResponse(pluginListPayload)])

    const result = await usePluginsStore
      .getState()
      .createFile({ fileName: "plugin.ts", content: "export {}", scope: "user" })

    expect(result.ok).toBe(true)
    expect(fetchCalls[0]?.input).toBe("/api/config/plugins/file?directory=%2Fworkspace%2Fproject")
    expect(fetchCalls[0]?.init?.method).toBe("POST")
    expect(requestBody(0)).toEqual({ fileName: "plugin.ts", content: "export {}", scope: "user" })
  })

  test("failed mutation returns ok false and leaves plugins unchanged", async () => {
    usePluginsStore.setState({ entries: [entry], files: [file] })
    queueFetchResponses([jsonResponse({ error: "boom" }, { status: 500 })])

    const result = await usePluginsStore.getState().createEntry({ spec: "bad", scope: "user" })

    expect(result).toEqual({ ok: false })
    expect(usePluginsStore.getState().entries).toEqual([entry])
    expect(usePluginsStore.getState().files).toEqual([file])
  })

  test("getById returns entries and files by id", () => {
    usePluginsStore.setState({ entries: [entry], files: [file] })

    expect(usePluginsStore.getState().getById(entry.id)).toEqual(entry)
    expect(usePluginsStore.getState().getById(file.id)).toEqual(file)
  })

  test("readFile fetches plugin file content", async () => {
    queueFetchResponses([jsonResponse({ fileName: "plugin.ts", scope: "user", content: "export {}" })])

    const result = await usePluginsStore.getState().readFile(file.id)

    expect(fetchCalls[0]?.input).toBe(
      `/api/config/plugins/file/${encodeURIComponent(file.id)}?directory=%2Fworkspace%2Fproject`,
    )
    expect(result).toEqual({ fileName: "plugin.ts", scope: "user", content: "export {}" })
  })

  test("loadRegistryInfo derives specs from entries and stores registry results", async () => {
    usePluginsStore.setState({ entries: [{ ...entry, spec: "foo@1" }] })
    queueFetchResponses([
      jsonResponse({
        results: [
          {
            kind: "npm-ok",
            spec: "foo@1",
            name: "foo",
            currentVersion: "1",
            latestVersion: "2",
            hasUpdate: true,
            versions: ["1", "2"],
          },
        ],
      }),
    ])

    await usePluginsStore.getState().loadRegistryInfo()

    expect(String(fetchCalls[0]?.input)).toContain("specs=foo%401")
    expect(usePluginsStore.getState().registryInfo["foo@1"]?.kind).toBe("npm-ok")
    expect(usePluginsStore.getState().isLoadingRegistry).toBe(false)
  })

  test("loadRegistryInfo force adds refresh flag", async () => {
    queueFetchResponses([jsonResponse({ results: [] })])

    await usePluginsStore.getState().loadRegistryInfo({ specs: ["foo@1"], force: true })

    expect(String(fetchCalls[0]?.input)).toContain("refresh=true")
  })

  test("keeps the newest registry metadata when refreshes overlap", async () => {
    const staleRefresh = createDeferred<Response>()
    const latestRefresh = createDeferred<Response>()
    const staleResult: RegistryResult = {
      kind: "npm-ok",
      spec: "plugin-a",
      name: "plugin-a",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      versions: ["1.0.0", "1.1.0"],
      hasUpdate: true,
    }
    const latestResult: RegistryResult = {
      kind: "npm-ok",
      spec: "plugin-a",
      name: "plugin-a",
      currentVersion: "1.1.0",
      latestVersion: "1.1.0",
      versions: ["1.0.0", "1.1.0"],
      hasUpdate: false,
    }
    queueFetchResponses([staleRefresh.promise, latestRefresh.promise])

    const firstLoad = usePluginsStore.getState().loadRegistryInfo({ specs: ["plugin-a"], force: true })
    const secondLoad = usePluginsStore.getState().loadRegistryInfo({ specs: ["plugin-a"], force: true })
    await Promise.resolve()

    latestRefresh.resolve(jsonResponse({ results: [latestResult] }))
    await secondLoad

    staleRefresh.resolve(jsonResponse({ results: [staleResult] }))
    await firstLoad

    expect(fetchCalls).toHaveLength(2)
    expect(usePluginsStore.getState().registryInfo["plugin-a"]).toEqual(latestResult)
    expect(usePluginsStore.getState().isLoadingRegistry).toBe(false)
  })

  test("loadRegistryInfo accepts explicit comma-joined specs", async () => {
    queueFetchResponses([jsonResponse({ results: [] })])

    await usePluginsStore.getState().loadRegistryInfo({ specs: ["x@1", "y@2"] })

    expect(String(fetchCalls[0]?.input)).toContain("specs=x%401,y%402")
  })

  test("loadRegistryInfo skips empty specs and clears loading flag", async () => {
    usePluginsStore.setState({ isLoadingRegistry: true })

    await usePluginsStore.getState().loadRegistryInfo({ specs: [] })

    expect(fetchCalls).toHaveLength(0)
    expect(usePluginsStore.getState().isLoadingRegistry).toBe(false)
  })

  test("loadPlugins success triggers registry load without blocking result", async () => {
    queueFetchResponses([jsonResponse(pluginListPayload), jsonResponse({ results: [registryOk] })])

    const result = await usePluginsStore.getState().loadPlugins()

    expect(result).toBe(true)
    expect(fetchCalls[0]?.input).toBe("/api/config/plugins?directory=%2Fworkspace%2Fproject")
    expect(registryCalls()).toHaveLength(1)
  })

  test("createEntry success refreshes registry for new spec with force", async () => {
    queueFetchResponses([
      jsonResponse(okMutationPayload),
      jsonResponse(pluginListPayload),
      jsonResponse({ results: [] }),
    ])

    const result = await usePluginsStore.getState().createEntry({ spec: "new-plugin@1", scope: "user" })

    expect(result.ok).toBe(true)
    expect(registryCalls()).toHaveLength(1)
    expect(String(registryCalls()[0]?.input)).toContain("specs=new-plugin%401")
    expect(String(registryCalls()[0]?.input)).toContain("refresh=true")
  })

  test("updateEntry success refreshes changed spec with force", async () => {
    usePluginsStore.setState({ entries: [entry] })
    queueFetchResponses([
      jsonResponse(okMutationPayload),
      jsonResponse(pluginListPayload),
      jsonResponse({ results: [] }),
    ])

    const result = await usePluginsStore.getState().updateEntry(entry.id, { spec: "plugin-b@2" })

    expect(result.ok).toBe(true)
    expect(registryCalls()).toHaveLength(1)
    expect(String(registryCalls()[0]?.input)).toContain("specs=plugin-b%402")
    expect(String(registryCalls()[0]?.input)).toContain("refresh=true")
  })

  test("updateEntry success refreshes existing spec when spec unchanged", async () => {
    usePluginsStore.setState({ entries: [entry] })
    queueFetchResponses([
      jsonResponse(okMutationPayload),
      jsonResponse(pluginListPayload),
      jsonResponse({ results: [] }),
    ])

    const result = await usePluginsStore.getState().updateEntry(entry.id, { options: { enabled: true } })

    expect(result.ok).toBe(true)
    expect(String(registryCalls()[0]?.input)).toContain("specs=plugin-a")
  })

  test("deleteEntry success removes deleted spec from registryInfo", async () => {
    usePluginsStore.setState({ entries: [entry], registryInfo: { [entry.spec]: registryOk } })
    queueFetchResponses([jsonResponse(okMutationPayload), jsonResponse({ entries: [], files: [] })])

    const result = await usePluginsStore.getState().deleteEntry(entry.id)

    expect(result.ok).toBe(true)
    expect(usePluginsStore.getState().registryInfo[entry.spec]).toBe(undefined)
  })

  test("updateToLatest updates npm-ok entry to latest version", async () => {
    usePluginsStore.setState({
      entries: [{ ...entry, id: "X", spec: "foo@1" }],
      registryInfo: {
        "foo@1": {
          kind: "npm-ok",
          spec: "foo@1",
          name: "foo",
          currentVersion: "1",
          latestVersion: "2",
          versions: ["1", "2"],
          hasUpdate: true,
        },
      },
    })
    queueFetchResponses([
      jsonResponse(okMutationPayload),
      jsonResponse(pluginListPayload),
      jsonResponse({ results: [] }),
    ])

    const result = await usePluginsStore.getState().updateToLatest("X")

    expect(result.ok).toBe(true)
    expect(fetchCalls[0]?.input).toBe("/api/config/plugins/entry/X?directory=%2Fworkspace%2Fproject")
    expect(requestBody(0)).toEqual({ spec: "foo@2" })
  })

  test("updateToLatest returns ok false when hasUpdate is false", async () => {
    usePluginsStore.setState({ entries: [entry], registryInfo: { [entry.spec]: registryOk } })

    const result = await usePluginsStore.getState().updateToLatest(entry.id)

    expect(result).toEqual({ ok: false })
    expect(fetchCalls).toHaveLength(0)
  })

  test("updateToLatest returns ok false for missing package registry result", async () => {
    usePluginsStore.setState({
      entries: [entry],
      registryInfo: {
        [entry.spec]: { kind: "npm-missing-package", spec: entry.spec, name: entry.spec, error: "missing" },
      },
    })

    const result = await usePluginsStore.getState().updateToLatest(entry.id)

    expect(result).toEqual({ ok: false })
    expect(fetchCalls).toHaveLength(0)
  })

  test("loadRegistryInfo chunks long spec lists into multiple registry requests", async () => {
    const entries = Array.from(
      { length: 50 },
      (_, index): PluginEntry => ({
        ...entry,
        id: `config:user:plugin-${index}`,
        spec: `plugin-${index}-${"x".repeat(20)}@1.0.0`,
      }),
    )
    usePluginsStore.setState({ entries })
    queueFetchResponses([jsonResponse({ results: [] }), jsonResponse({ results: [] })])

    await usePluginsStore.getState().loadRegistryInfo()

    expect(registryCalls()).toHaveLength(2)
  })
})
