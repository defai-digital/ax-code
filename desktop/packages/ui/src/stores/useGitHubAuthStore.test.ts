import { afterEach, describe, expect, test, vi } from "vitest"
import type { GitHubAuthStatus, RuntimeAPIs } from "@/lib/api/types"

type RuntimeGitHub = NonNullable<RuntimeAPIs["github"]>

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

const createRuntimeGitHub = () => {
  const request = createDeferred<GitHubAuthStatus>()
  const runtimeGitHub = {
    authStatus: vi.fn(() => request.promise),
  } as unknown as RuntimeGitHub
  return { request, runtimeGitHub }
}

const importStore = async () => {
  vi.resetModules()
  return import("./useGitHubAuthStore")
}

describe("useGitHubAuthStore", () => {
  afterEach(() => {
    vi.resetModules()
  })

  test("does not reuse an in-flight auth refresh across different runtime clients", async () => {
    const { useGitHubAuthStore } = await importStore()
    const first = createRuntimeGitHub()
    const second = createRuntimeGitHub()

    const firstRefresh = useGitHubAuthStore.getState().refreshStatus(first.runtimeGitHub, { force: true })
    const secondRefresh = useGitHubAuthStore.getState().refreshStatus(second.runtimeGitHub, { force: true })
    await Promise.resolve()

    expect(first.runtimeGitHub.authStatus).toHaveBeenCalledTimes(1)
    expect(second.runtimeGitHub.authStatus).toHaveBeenCalledTimes(1)

    second.request.resolve({ connected: true, user: { login: "second" } })
    await secondRefresh

    first.request.resolve({ connected: false, user: { login: "first" } })
    await firstRefresh

    expect(useGitHubAuthStore.getState().status).toMatchObject({
      connected: true,
      user: { login: "second" },
    })
  })
})
