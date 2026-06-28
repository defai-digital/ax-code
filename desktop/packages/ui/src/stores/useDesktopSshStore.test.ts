import { afterEach, describe, expect, test, vi } from "vitest"
import type { DesktopSshInstance, DesktopSshInstanceStatus } from "@/lib/desktopSsh"

const remoteInstance: DesktopSshInstance = {
  id: "remote-1",
  nickname: "Remote 1",
  sshCommand: "ssh example.com",
  connectionTimeoutSec: 30,
  remoteOpenchamber: {
    mode: "managed",
    keepRunning: true,
    installMethod: "npm",
    uploadBundleOverSsh: false,
  },
  localForward: {
    bindHost: "127.0.0.1",
  },
  auth: {},
  portForwards: [],
}

const createStatus = (
  phase: DesktopSshInstanceStatus["phase"],
  updatedAtMs: number,
): DesktopSshInstanceStatus => ({
  id: "remote-1",
  phase,
  detail: phase,
  localUrl: phase === "ready" ? "http://127.0.0.1:3902" : undefined,
  localPort: phase === "ready" ? 3902 : undefined,
  remotePort: phase === "ready" ? 3902 : undefined,
  startedByUs: false,
  retryAttempt: 0,
  requiresUserAction: false,
  updatedAtMs,
})

const importStore = async (options: {
  snapshot: DesktopSshInstanceStatus[]
  emitDuringListen?: DesktopSshInstanceStatus
}) => {
  vi.resetModules()

  let statusListener: ((status: DesktopSshInstanceStatus) => void) | null = null

  vi.doMock("@/lib/desktopSsh", () => ({
    createDesktopSshInstance: (id: string, sshCommand: string) => ({
      ...remoteInstance,
      id,
      sshCommand,
    }),
    desktopSshConnect: vi.fn(async () => {}),
    desktopSshDisconnect: vi.fn(async () => {}),
    desktopSshImportHosts: vi.fn(async () => []),
    desktopSshInstancesGet: vi.fn(async () => ({ instances: [remoteInstance] })),
    desktopSshInstancesSet: vi.fn(async () => {}),
    desktopSshStatus: vi.fn(async () => options.snapshot),
    listenDesktopSshStatus: vi.fn(async (listener: (status: DesktopSshInstanceStatus) => void) => {
      statusListener = listener
      if (options.emitDuringListen) {
        listener(options.emitDuringListen)
      }
      return async () => {}
    }),
  }))

  const storeModule = await import("./useDesktopSshStore")
  return {
    ...storeModule,
    emitStatus: (status: DesktopSshInstanceStatus) => {
      if (!statusListener) {
        throw new Error("SSH status listener was not registered")
      }
      statusListener(status)
    },
  }
}

describe("useDesktopSshStore", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/desktopSsh")
    vi.resetModules()
  })

  test("keeps live SSH status events received while load is finishing", async () => {
    const idleSnapshot = createStatus("idle", 100)
    const readyEvent = createStatus("ready", 200)
    const { useDesktopSshStore } = await importStore({
      snapshot: [idleSnapshot],
      emitDuringListen: readyEvent,
    })

    await useDesktopSshStore.getState().load()

    expect(useDesktopSshStore.getState().statusesById["remote-1"]).toMatchObject({
      phase: "ready",
      updatedAtMs: 200,
      localUrl: "http://127.0.0.1:3902",
    })
  })

  test("ignores older SSH status events that arrive after a newer one", async () => {
    const readySnapshot = createStatus("ready", 200)
    const staleEvent = createStatus("forwarding", 150)
    const { emitStatus, useDesktopSshStore } = await importStore({
      snapshot: [readySnapshot],
    })

    await useDesktopSshStore.getState().load()
    emitStatus(staleEvent)

    expect(useDesktopSshStore.getState().statusesById["remote-1"]).toMatchObject({
      phase: "ready",
      updatedAtMs: 200,
    })
  })
})
