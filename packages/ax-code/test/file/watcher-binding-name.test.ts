import { expect, test } from "vitest"
import { FileWatcher } from "../../src/file/watcher"

// AX_CODE_LIBC is only defined in packaged builds. In source mode and tests a
// bare reference threw ReferenceError on Linux, so the parcel binding was never
// loaded there and the watcher silently fell back to polling.
test("parcel binding name resolves on Linux without the build-time libc define", () => {
  expect(FileWatcher.parcelBindingName("linux", "x64")).toBe("@parcel/watcher-linux-x64-glibc")
  expect(FileWatcher.parcelBindingName("linux", "arm64")).toBe("@parcel/watcher-linux-arm64-glibc")
})

test("parcel binding name has no libc suffix outside Linux", () => {
  expect(FileWatcher.parcelBindingName("darwin", "arm64")).toBe("@parcel/watcher-darwin-arm64")
  expect(FileWatcher.parcelBindingName("win32", "x64")).toBe("@parcel/watcher-win32-x64")
})
