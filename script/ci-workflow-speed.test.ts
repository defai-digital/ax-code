import { describe, expect, test } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const toolchain = readFileSync(".github/actions/setup-ax-code-toolchain/action.yml", "utf8")
const release = readFileSync(".github/workflows/release.yml", "utf8")
const ci = readFileSync(".github/workflows/ax-code-ci.yml", "utf8")
const repoStructure = readFileSync(".github/workflows/repo-structure.yml", "utf8")
const codeql = readFileSync(".github/workflows/codeql.yml", "utf8")
const typescriptNative = readFileSync(".github/workflows/typescript-native.yml", "utf8")

function workflowJob(source: string, name: string) {
  return source.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  \\w[\\w-]*:|$(?![\\s\\S]))`, "m"))?.[0]
}

function githubAutomationSources(directory = ".github"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return githubAutomationSources(target)
    if (!/\.(?:ya?ml|sh)$/.test(entry.name)) return []
    return [readFileSync(target, "utf8")]
  })
}

describe("CI workflow speed policy", () => {
  test("AX Code and SDK automation enforce the Node 26 support floor", () => {
    for (const source of githubAutomationSources()) {
      for (const match of source.matchAll(/node-version:\s*["']?(\d+)/g)) {
        expect(Number(match[1])).toBeGreaterThanOrEqual(26)
      }
    }
    expect(toolchain).toContain('default: "26"')
    for (const filename of ["package.json", "packages/ax-code/package.json", "packages/sdk/js/package.json"]) {
      expect(JSON.parse(readFileSync(filename, "utf8")).engines.node).toBe(">=26")
    }
    expect(JSON.parse(readFileSync("package.json", "utf8")).scripts.preinstall).toContain(
      "node script/check-node-version.mjs",
    )
    expect(readFileSync("script/only-allow-pnpm.mjs", "utf8")).toContain("!supportsNodeVersion()")
  })

  test("repository script tests run once in repo-structure, not in ax-code CI", () => {
    expect(ci).not.toContain("pnpm run test:scripts")
    expect(repoStructure).toContain("pnpm run test:scripts")
  })

  test("native evidence rebuilds skip unchanged pull requests and pushes and cache cargo", () => {
    const plan = workflowJob(ci, "evidence-plan")
    const lane = workflowJob(ci, "evidence-native")
    const action = readFileSync(".github/actions/build-evidence-cache/action.yml", "utf8")
    expect(plan).toBeDefined()
    expect(lane).toBeDefined()
    expect(plan).toContain("Decide native evidence rebuild")
    expect(plan).toContain("steps.native.outputs.run")
    expect(plan).toContain('cache: ""')
    expect(plan).toContain("script/ci-native-evidence-needed.ts")
    expect(plan).toContain("Skipping native evidence rebuild")
    expect(plan).toContain('event_name="${{ github.event_name }}"')
    expect(plan).toContain("/compare/${before}...${{ github.sha }}")
    expect(plan).toContain("github.event.pull_request.number")
    expect(plan).not.toContain('if [ "${{ github.event_name }}" != "pull_request" ]; then')
    expect(lane).toContain("needs: evidence-plan")
    expect(lane).toContain("needs.evidence-plan.outputs.run == 'true'")
    expect(lane).not.toContain("Decide native evidence rebuild")
    expect(action).toContain("Swatinem/rust-cache@f13886b937689c021905a6b90929199931d60db1")
    expect(action).toContain("workspaces: crates -> target")
  })

  test("deterministic tests split across four GitHub runners without in-process shards", () => {
    const lane = workflowJob(ci, "deterministic")
    expect(lane).toBeDefined()
    expect(lane).toContain("timeout-minutes: 20")
    expect(lane).toContain("shard: [1, 2, 3, 4]")
    expect(lane).toContain("AX_TEST_SHARD_INDEX: ${{ matrix.shard }}")
    expect(lane).toContain('AX_TEST_SHARD_COUNT: "4"')
    expect(lane).toContain("test:ci -- deterministic --rerun-on-fail 0")
    expect(lane).not.toContain("AX_TEST_SHARD_SIZE")
    expect(lane).not.toContain("AX_TEST_MAX_WORKERS")
    expect(lane).toContain("name: ax-code-deterministic-report-${{ matrix.shard }}")
  })

  test("SDK generation, typecheck, and scans stay off the deterministic test runners", () => {
    const lane = workflowJob(ci, "checks")
    expect(lane).toBeDefined()
    expect(lane).toContain("pnpm --dir packages/sdk/js run build")
    expect(lane).toContain("pnpm --dir packages/sdk/js test")
    expect(lane).toContain("pnpm --dir packages/ax-code run typecheck")
    expect(lane).toContain("pnpm run test:extracted-packages")
    expect(lane).not.toContain("test:ci -- deterministic")
  })

  test("runtime contracts run in a bounded lane with their own report and no retries", () => {
    const lane = workflowJob(ci, "runtime-contract")
    expect(lane).toBeDefined()
    expect(lane).toContain("timeout-minutes: 15")
    expect(lane).toContain('AX_TEST_MAX_WORKERS: "2"')
    expect(lane).toContain('node-version: "26"')
    expect(lane).toContain("test:ci -- runtime-contract --rerun-on-fail 0")
    expect(lane).toContain("name: ax-code-runtime-contract-report")
    expect(lane).toContain("if-no-files-found: error")
    for (const file of ["test-ci.ts", "test-groups.ts"]) {
      const source = readFileSync(`packages/ax-code/script/${file}`, "utf8")
      expect(source).toContain('"--retry=0"')
    }
  })

  test("the shared JS toolchain caches the pnpm store", () => {
    expect(toolchain).toMatch(/pnpm\/action-setup@[a-f0-9]{40} # v6/)
    expect(toolchain).toContain("run_install: false")
    expect(toolchain).toContain("default: pnpm")
    expect(toolchain).toContain("cache: ${{ inputs.cache }}")
    expect(toolchain).toMatch(/cache-dependency-path:[\s\S]*pnpm-lock\.yaml/)
  })

  test("the shared JS toolchain does not prepare a local ax-tui checkout", () => {
    expect(toolchain).not.toContain("repository: defai-digital/ax-tui")
    expect(toolchain).not.toContain("ax-tui-src")
    expect(toolchain).not.toContain("ln -sfn")
    expect(toolchain).toContain("cache-dependency-path: pnpm-lock.yaml")
  })

  test("the registry-backed Node 26 TUI startup lane is enabled by default", () => {
    const lane = ci.match(/^  tui-node26-smoke:\n[\s\S]*?(?=^  \w[\w-]*:|$(?![\s\S]))/m)?.[0]
    expect(lane).toBeDefined()
    expect(lane).not.toContain("AX_CODE_TUI_NODE26_SMOKE")
    expect(lane).toContain('node-version: "26"')
    expect(lane).toContain("pnpm install --frozen-lockfile")
    expect(lane).toContain("tui:startup-smoke")
  })

  test("GitHub automation remains Node and pnpm only", () => {
    const automation = githubAutomationSources().join("\n")
    expect(automation).not.toMatch(/oven-sh\/setup-bun|\bbunx\b|\bbun-version\b/i)
    expect(automation).not.toMatch(/\bbun\s+(?:install|run|test|build|x)\b/i)
  })

  test("the release workflow never cancels an in-flight publish", () => {
    expect(release).toMatch(/cancel-in-progress:\s*false/)
  })

  test("the release workflow runs the self-scan before deterministic tests", () => {
    const scan = release.indexOf("pnpm run check:self-scan")
    const deterministic = release.indexOf("test:ci -- deterministic")
    expect(scan).toBeGreaterThan(-1)
    expect(deterministic).toBeGreaterThan(scan)
    const decision = release.indexOf("script/ci-release-deterministic-skip.ts")
    expect(decision).toBeGreaterThan(scan)
    expect(deterministic).toBeGreaterThan(decision)
    expect(release).toContain("steps.deterministic.outputs.skip != 'true'")
    expect(release).toContain("checks: read")
  })

  test("release installer tests stay on the platform that owns them", () => {
    expect(release).toContain("runner.os != 'Windows'")
    expect(release).toContain("pnpm exec vitest run script/install-unix.test.ts")
    expect(release).toContain("runner.os == 'Windows'")
    expect(release).toContain("pnpm exec vitest run script/install-powershell.test.ts")
    expect(release).not.toContain("pnpm exec vitest run script/install-unix.test.ts script/install-powershell.test.ts")
  })

  test("extended CodeQL stays on the weekly schedule", () => {
    expect(codeql).toContain('cron: "23 8 * * 1"')
    expect(codeql).toContain("workflow_dispatch:")
    expect(codeql).not.toMatch(/^ {2}push:/m)
    expect(codeql).not.toMatch(/^ {2}pull_request:/m)
  })

  test("TypeScript native qualification leaves windows-11-arm off the push path", () => {
    const plan = workflowJob(typescriptNative, "native-matrix")
    const lane = workflowJob(typescriptNative, "native")
    expect(plan).toBeDefined()
    expect(lane).toBeDefined()
    expect(plan).toContain('"${{ github.event_name }}" = "schedule"')
    expect(plan).toContain('"${{ github.event_name }}" = "workflow_dispatch"')
    expect(plan).toContain("windows-11-arm")
    expect(lane).toContain("needs: native-matrix")
    expect(lane).toContain("fromJSON(needs.native-matrix.outputs.include)")
    expect(lane).not.toContain("windows-11-arm")
    expect(typescriptNative).toContain('cron: "47 6 * * 1"')
  })
})
