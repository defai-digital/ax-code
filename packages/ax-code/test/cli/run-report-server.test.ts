import { afterEach, expect, test, vi } from "vitest"
import { Server } from "../../src/server/server"
import { RunReportServer } from "../../src/cli/cmd/run-report-server"

afterEach(() => {
  RunReportServer.clear()
  vi.restoreAllMocks()
})

test("a failed start is forgotten so the next ensure() retries instead of replaying the rejection", async () => {
  const live = { port: 4107, stop: async () => {} } as unknown as Awaited<ReturnType<typeof Server.listen>>
  const listen = vi.spyOn(Server, "listen").mockRejectedValueOnce(new Error("EADDRINUSE")).mockResolvedValueOnce(live)
  await expect(RunReportServer.ensure()).rejects.toThrow("EADDRINUSE")
  await expect(RunReportServer.ensure()).resolves.toBe(live)
  expect(listen).toHaveBeenCalledTimes(2)
  // A live server stays shared.
  await expect(RunReportServer.ensure()).resolves.toBe(live)
  expect(listen).toHaveBeenCalledTimes(2)
})
