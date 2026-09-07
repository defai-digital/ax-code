import { spawnSync } from "node:child_process"
import { describe, expect, test } from "vitest"
import { AX_CODE_PROCESS_TITLE, setAxCodeProcessTitle } from "../../src/util/process-title"

describe("process title", () => {
  test("preserves macOS argv storage for terminal job-title readers", () => {
    let writes = 0
    const runtime = {
      platform: "darwin" as const,
      get title() {
        return "AX-Code --import tsx index-node-tui.ts"
      },
      set title(_value: string) {
        writes++
      },
    }

    setAxCodeProcessTitle(runtime)

    expect(writes).toBe(0)
    expect(runtime.title).toBe("AX-Code --import tsx index-node-tui.ts")
  })

  test.each(["linux", "win32"] as const)("keeps the short machine name on %s", (platform) => {
    const runtime = { platform, title: "node" }

    setAxCodeProcessTitle(runtime)

    expect(runtime.title).toBe(AX_CODE_PROCESS_TITLE)
  })

  test("does not block startup when a runtime rejects title writes", () => {
    const runtime = {
      platform: "linux" as const,
      get title() {
        return "node"
      },
      set title(_value: string) {
        throw new Error("Process title is read-only")
      },
    }

    expect(() => setAxCodeProcessTitle(runtime)).not.toThrow()
  })

  test.skipIf(process.platform !== "darwin" || Number(process.versions.node.split(".")[0]) < 26)(
    "keeps environment entries out of macOS native process arguments",
    () => {
      // Use a real child and KERN_PROCARGS2, the native source of terminal job
      // details. ps and process.argv use different views and miss this bug.
      // Keep the child's environment synthetic so a regression cannot expose
      // the developer's environment through either argv or assertion output.
      const script = `
        import { dlopen } from "node:ffi"
        const { setAxCodeProcessTitle } = await import(process.argv[1])
        setAxCodeProcessTitle()
        const libc = dlopen("/usr/lib/libc.dylib", {
          sysctl: { arguments: ["pointer", "u32", "pointer", "pointer", "pointer", "u64"], return: "i32" },
        })
        const mib = new Int32Array([1, 49, process.pid])
        const bytes = Buffer.alloc(1024 * 1024)
        const size = new BigUint64Array([BigInt(bytes.length)])
        if (libc.functions.sysctl(mib, mib.length, bytes, size, null, 0n) !== 0) {
          throw new Error("Cannot inspect native process arguments")
        }
        const argc = bytes.readInt32LE(0)
        const strings = bytes.subarray(4, Number(size[0])).toString("utf8").split("\\0").filter(Boolean)
        process.stdout.write(strings.slice(1, argc + 1).join("\\n"))
      `
      const child = spawnSync(
        process.execPath,
        [
          "--experimental-ffi",
          "--disable-warning=ExperimentalWarning",
          "--input-type=module",
          "--eval",
          script,
          new URL("../../src/util/process-title.ts", import.meta.url).href,
        ],
        {
          encoding: "utf8",
          env: { AX_TITLE_TEST_SENTINEL: "public-environment-marker" },
          timeout: 10_000,
        },
      )

      expect(child.error).toBeUndefined()
      expect(child.status, child.stderr).toBe(0)
      expect(child.stdout).toContain("--input-type=module")
      expect(child.stdout).not.toContain("AX_TITLE_TEST_SENTINEL=public-environment-marker")
    },
  )
})
