import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { writeCanvasDocument } from "./store.js"

const waitForAsyncWork = () => new Promise((resolve) => setImmediate(resolve))

const createDeferred = () => {
  let resolve
  let reject
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

describe("canvas store", () => {
  it("serializes concurrent writes for the same canvas so the latest request wins", async () => {
    const projectDirectory = "/workspace/project"
    const documentPath = path.posix.join(projectDirectory, ".ax-code/canvas/main.canvas.json")
    const files = new Map()
    const firstWrite = createDeferred()

    const fsPromises = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (targetPath, content) => {
        files.set(targetPath, content)
        if (fsPromises.writeFile.mock.calls.length === 1) {
          await firstWrite.promise
        }
      }),
      rename: vi.fn(async (sourcePath, targetPath) => {
        files.set(targetPath, files.get(sourcePath))
        files.delete(sourcePath)
      }),
      unlink: vi.fn(async (targetPath) => {
        files.delete(targetPath)
      }),
    }

    const olderWrite = writeCanvasDocument({
      fsPromises,
      path: path.posix,
      projectDirectory,
      document: {
        version: 1,
        title: "Older draft",
        elements: [],
      },
    })

    await waitForAsyncWork()
    expect(fsPromises.writeFile).toHaveBeenCalledTimes(1)

    const newerWrite = writeCanvasDocument({
      fsPromises,
      path: path.posix,
      projectDirectory,
      document: {
        version: 1,
        title: "Newer draft",
        elements: [],
      },
    })

    await waitForAsyncWork()
    expect(fsPromises.writeFile).toHaveBeenCalledTimes(1)

    firstWrite.resolve()
    await Promise.all([olderWrite, newerWrite])

    expect(fsPromises.writeFile).toHaveBeenCalledTimes(2)
    expect(JSON.parse(files.get(documentPath))).toMatchObject({
      version: 1,
      id: "main",
      title: "Newer draft",
    })
  })
})
