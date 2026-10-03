import { describe, expect, test } from "vitest"
import { readFileSync, readdirSync } from "node:fs"

const directory = ".github/workflows"
const workflows = readdirSync(directory)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, source: readFileSync(`${directory}/${name}`, "utf8") }))

describe("CI resource budgets", () => {
  for (const { name, source } of workflows) {
    test(`${name} bounds every runner job without adding unsupported reusable-job timeouts`, () => {
      const jobs = source.slice(source.indexOf("\njobs:\n") + "\njobs:\n".length)
      const blocks = [...jobs.matchAll(/^  ([\w-]+):\n[\s\S]*?(?=^  [\w-]+:|$(?![\s\S]))/gm)]
      expect(blocks.length).toBeGreaterThan(0)
      for (const [block, job] of blocks) {
        const timeout = block.match(/^    timeout-minutes: (\d+)$/m)
        if (/^    uses:/m.test(block)) {
          expect(timeout, `${name}/${job} calls a reusable workflow`).toBeNull()
          continue
        }
        expect(block, `${name}/${job}`).toMatch(/^    runs-on:/m)
        expect(timeout, `${name}/${job} needs a job timeout`).not.toBeNull()
        expect(Number(timeout?.[1])).toBeGreaterThan(0)
        expect(Number(timeout?.[1])).toBeLessThanOrEqual(90)
      }
    })

    test(`${name} gives each uploaded artifact an explicit retention budget`, () => {
      const steps = [...source.matchAll(/^      - [\s\S]*?(?=^      - |^  [\w-]+:|$(?![\s\S]))/gm)]
      for (const [step] of steps) {
        if (!/uses: actions\/upload-artifact@/.test(step)) continue
        const retention = step.match(/^          retention-days: (\d+)$/m)
        expect(retention, `${name}: ${step.split("\n")[0]}`).not.toBeNull()
        const days = Number(retention?.[1])
        expect(days).toBeGreaterThan(0)
        expect(days).toBeLessThanOrEqual(
          name === "release.yml" || name === "windows-installer-qualification.yml" ? 30 : 14,
        )
        if (/name: dist-/.test(step)) expect(days).toBe(1)
        if (/name: (signatures-|defender-)/.test(step)) expect(days).toBe(30)
      }
    })
  }

  test("Windows qualification cancels superseded source checks and preserves manual evidence runs", () => {
    const source = readFileSync(`${directory}/windows-installer-qualification.yml`, "utf8")
    const concurrency = source.match(/^concurrency:\n[\s\S]*?(?=^\S|$(?![\s\S]))/m)?.[0]
    expect(concurrency).toContain("github.event.pull_request.number || github.ref")
    expect(concurrency).toContain("github.event_name == 'workflow_dispatch' && github.run_id")
    expect(concurrency).toContain("cancel-in-progress: ${{ github.event_name != 'workflow_dispatch' }}")
  })

  test("release build and publish budgets leave room for native compilation and mirror convergence", () => {
    const source = readFileSync(`${directory}/release.yml`, "utf8")
    const job = (workflow: string, name: string) =>
      workflow.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [\\w-]+:|$(?![\\s\\S]))`, "m"))?.[0]
    expect(job(source, "build")).toMatch(/^    timeout-minutes: 90$/m)
    expect(job(source, "publish")).toMatch(/^    timeout-minutes: 45$/m)
    const smoke = readFileSync(`${directory}/install-matrix-smoke.yml`, "utf8")
    // Homebrew polls for up to 30 minutes before installing and verifying.
    expect(job(smoke, "homebrew")).toMatch(/^    timeout-minutes: 45$/m)
  })
})
