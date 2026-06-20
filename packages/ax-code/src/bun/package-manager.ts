import { runtimeMode, type RuntimeMode } from "../installation/runtime-mode"

/**
 * Which package manager drives ax-code's *dynamic* installs (provider SDKs,
 * plugins, config dependencies, LSP servers) at runtime.
 *
 * A Node runtime (`node-bundled`) ships a `node` executable, which is not a
 * package manager — `node add pkg` is meaningless and fails. On that runtime
 * we drive npm (which ships with Node); every Bun runtime keeps using bun.
 *
 * Keeping the decision in one pure, testable function — rather than scattering
 * `process.execPath`/`runtimeMode()` checks across the install call sites —
 * keeps the Bun→Node migration auditable and the per-runtime command shape
 * unit-testable without a real install.
 */
export type PackageManagerKind = "bun" | "npm"

export function packageManagerKind(mode: RuntimeMode = runtimeMode()): PackageManagerKind {
  return mode === "node-bundled" ? "npm" : "bun"
}

/**
 * npm command shapes used on the `node-bundled` runtime. The bun shapes are
 * intentionally left inline at each call site so the long-standing Bun path
 * stays byte-identical (and its existing tests keep covering it verbatim);
 * only the new Node path routes through here.
 *
 * `--prefix <cwd>` pins npm's install location to ax-code's cache/plugin dir
 * (it reads/writes `<cwd>/package.json` and installs into `<cwd>/node_modules`)
 * independently of the spawn cwd, mirroring bun's `--cwd <cwd>`.
 */
export const NpmManager = {
  executable: "npm",
  /** install one exact-pinned package into `cwd` */
  addArgs(pkg: string, version: string, cwd: string): string[] {
    return ["install", "--save-exact", "--prefix", cwd, `${pkg}@${version}`]
  },
  /** install the dependencies already declared in `cwd`'s package.json */
  installArgs(cwd: string): string[] {
    return ["install", "--prefix", cwd]
  },
  /** print a single registry field for a package (e.g. its latest `version`) */
  infoArgs(pkg: string, field: string): string[] {
    return ["view", pkg, field]
  },
} as const
