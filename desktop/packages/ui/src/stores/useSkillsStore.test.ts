import { beforeEach, describe, expect, test, vi } from "vitest"

let currentDirectory = "/workspace/project"

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

vi.doMock("@/lib/ax-code/client", () => ({
  axCodeClient: {
    getDirectory: () => currentDirectory,
  },
}))

vi.doMock("@/lib/configSync", () => ({
  emitConfigChange: vi.fn(() => undefined),
  scopeMatches: vi.fn(() => false),
  subscribeToConfigChanges: vi.fn(() => () => undefined),
}))

vi.doMock("@/lib/configUpdate", () => ({
  startConfigUpdate: vi.fn(() => undefined),
  finishConfigUpdate: vi.fn(() => undefined),
  updateConfigUpdateMessage: vi.fn(() => undefined),
  subscribeConfigUpdate: vi.fn(() => () => undefined),
  getConfigUpdateSnapshot: vi.fn(() => ({ isUpdating: false, message: null })),
}))

const { useSkillsStore } = await import("./useSkillsStore")

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })

const fetchCalls: Array<RequestInfo | URL> = []
let queuedResponses: Array<Response | Promise<Response>> = []

const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  fetchCalls.push(input)
  return queuedResponses.shift() ?? jsonResponse({ skills: [] })
})

const resetStore = () => {
  useSkillsStore.setState({
    selectedSkillName: null,
    skills: [],
    isLoading: false,
    skillDraft: null,
  })
}

describe("useSkillsStore", () => {
  beforeEach(() => {
    currentDirectory = "/workspace/project"
    resetStore()
    fetchCalls.length = 0
    queuedResponses = []
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  test("keeps the newest skill list after switching directories", async () => {
    const staleSkills = createDeferred<Response>()
    const latestSkills = createDeferred<Response>()
    queuedResponses = [staleSkills.promise, latestSkills.promise]

    currentDirectory = "/workspace/old-project"
    const oldLoad = useSkillsStore.getState().loadSkills()
    currentDirectory = "/workspace/new-project"
    const newLoad = useSkillsStore.getState().loadSkills()
    await Promise.resolve()

    latestSkills.resolve(
      jsonResponse({
        skills: [
          {
            name: "new-skill",
            path: "/workspace/new-project/skills/new-skill/SKILL.md",
            scope: "project",
            source: "ax-code",
            sources: { md: { description: "new" } },
          },
        ],
      }),
    )
    await newLoad

    staleSkills.resolve(
      jsonResponse({
        skills: [
          {
            name: "old-skill",
            path: "/workspace/old-project/skills/old-skill/SKILL.md",
            scope: "project",
            source: "ax-code",
            sources: { md: { description: "old" } },
          },
        ],
      }),
    )
    await oldLoad

    expect(fetchCalls.map(String)).toEqual([
      "/api/config/skills?directory=%2Fworkspace%2Fold-project",
      "/api/config/skills?directory=%2Fworkspace%2Fnew-project",
    ])
    expect(useSkillsStore.getState().skills).toEqual([
      {
        name: "new-skill",
        path: "/workspace/new-project/skills/new-skill/SKILL.md",
        scope: "project",
        source: "ax-code",
        description: "new",
        group: undefined,
      },
    ])
    expect(useSkillsStore.getState().isLoading).toBe(false)
  })
})
