import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const pkg = fileURLToPath(new URL("../", import.meta.url))
const version = "0.2.129"
const cli = process.env.AX_WASM_BINDGEN || "wasm-bindgen"
let installed
try {
  installed = execFileSync(cli, ["--version"], { encoding: "utf8" }).trim()
} catch {
  throw new Error(`Install wasm-bindgen-cli ${version}: cargo install wasm-bindgen-cli --version ${version} --locked`)
}
if (installed !== `wasm-bindgen ${version}`) throw new Error(`Expected wasm-bindgen ${version}; got ${installed}`)
// Use the same rustup toolchain whose Wasm standard library is installed.
// A Homebrew cargo/rustc earlier on PATH otherwise misses rustup's targets.
const toolchain = process.env.AX_DIFF_WASM_TOOLCHAIN || "stable"
const cargo = execFileSync("rustup", ["which", "--toolchain", toolchain, "cargo"], { encoding: "utf8" }).trim()
const rustc = execFileSync("rustup", ["which", "--toolchain", toolchain, "rustc"], { encoding: "utf8" }).trim()
execFileSync(
  cargo,
  [
    "build",
    "--locked",
    "--manifest-path",
    `${root}crates/Cargo.toml`,
    "-p",
    "ax-code-diff-wasm",
    "--target-dir",
    `${root}crates/target`,
    "--target",
    "wasm32-unknown-unknown",
    "--release",
  ],
  { stdio: "inherit", env: { ...process.env, RUSTC: rustc } },
)
await mkdir(`${pkg}wasm`, { recursive: true })
execFileSync(
  cli,
  [
    `${root}crates/target/wasm32-unknown-unknown/release/ax_code_diff_wasm.wasm`,
    "--target",
    "web",
    "--out-dir",
    `${pkg}wasm`,
    "--out-name",
    "ax_code_diff_wasm",
  ],
  { stdio: "inherit" },
)
// Generated web-target JS must remain ESM even when deployed without the parent package.json.
await writeFile(`${pkg}wasm/package.json`, '{"type":"module"}\n')
await mkdir(`${pkg}dist`, { recursive: true })
await Promise.all([
  build({
    entryPoints: [`${pkg}src/browser.ts`, `${pkg}src/browser-worker.ts`],
    outdir: `${pkg}dist`,
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
  }),
  build({
    entryPoints: [`${pkg}src/node.ts`, `${pkg}src/node-worker.ts`],
    outdir: `${pkg}dist`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node26",
  }),
])
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: pkg, stdio: "inherit" })
