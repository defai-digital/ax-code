import { build, type BuildOptions, type Plugin } from "esbuild"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { transformSolidSource, resolveNodeSolidRuntimeImport } from "../solid/source/scripts/solid-transform.js"

const root = fileURLToPath(new URL("../", import.meta.url))
const output = path.resolve(root, process.argv[2] ?? ".internal/build/package")
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))

function declarations(config: string, outDir: string): void {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config, "--outDir", outDir],
    {
      cwd: root,
      stdio: "inherit",
    },
  )
  if (result.status !== 0) throw result.error ?? new Error(`Declaration build failed: ${config}`)
}

const nativeDelivery: Plugin = {
  name: "ax-tui-native-delivery",
  setup(builder) {
    builder.onResolve({ filter: /^(?:\.\.\/)+native\/index\.js$/ }, () => ({ path: "./native/index.js", external: true }))
  },
}

function solidTransform(node: boolean): Plugin {
  return {
    name: "ax-tui-solid",
    setup(builder) {
      builder.onLoad({ filter: /\.tsx$/ }, async ({ path: filename }) => ({
        contents: await transformSolidSource(await readFile(filename, "utf8"), { filename }),
        loader: "js",
      }))
      if (node) {
        builder.onResolve({ filter: /^solid-js(?:\/store)?$/ }, ({ path: specifier }) => ({
          path: resolveNodeSolidRuntimeImport(specifier)!,
          external: true,
        }))
      }
    },
  }
}

const common: BuildOptions = {
  absWorkingDir: root,
  format: "esm",
  platform: "node",
  target: "esnext",
  bundle: true,
  packages: "external",
  legalComments: "inline",
  logLevel: "warning",
}

// Explicit output directories must be empty; never recursively delete a caller's path.
if (process.argv[2]) {
  await mkdir(output, { recursive: true })
  if ((await readdir(output)).length) throw new Error(`Build output directory must be empty: ${output}`)
} else {
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
}
declarations("tsconfig.build.json", output)
declarations("native/tsconfig.build.json", path.join(output, "native"))
// Solid must see this build's core API, including newly added exports, rather
// than the declarations from the previous committed distribution.
const declarationConfig = await mkdtemp(path.join(os.tmpdir(), "ax-tui-declarations-"))
try {
  const config = path.join(declarationConfig, "tsconfig.json")
  await writeFile(config, JSON.stringify({
    extends: path.join(root, "solid/tsconfig.build.json"),
    compilerOptions: {
      typeRoots: [path.join(root, "node_modules/@types")],
      paths: {
        "@defai-digital/ax-tui": [path.join(output, "index.d.ts")],
        "@defai-digital/ax-tui/testing": [path.join(output, "testing.d.ts")],
        "@defai-digital/ax-tui/runtime-plugin": [path.join(output, "runtime-plugin.d.ts")],
      },
    },
  }))
  declarations(config, path.join(output, "solid"))
} finally {
  await rm(declarationConfig, { recursive: true, force: true })
}
await build({
  ...common,
  entryPoints: ["src/index.ts", "src/testing.ts", "src/yoga.ts"],
  outdir: output,
  splitting: true,
  chunkNames: "index-[hash]",
  plugins: [nativeDelivery],
  external: ["*.wasm", "*.scm"],
})
await build({
  ...common,
  entryPoints: ["src/lib/tree-sitter/parser.worker.ts"],
  outfile: path.join(output, "parser.worker.js"),
})
await build({
  ...common,
  entryPoints: ["src/lib/tree-sitter/update-assets.ts"],
  outfile: path.join(output, "lib/tree-sitter/update-assets.js"),
})

for (const runtime of ["node", "bun"] as const) {
  await build({
    ...common,
    entryPoints: ["solid/source/index.ts"],
    outfile: path.join(output, runtime === "node" ? "solid/index.js" : "solid/index.bun.js"),
    plugins: [solidTransform(runtime === "node")],
  })
}
for (const entry of ["components", "jsx-runtime", "jsx-dev-runtime"]) {
  await build({ ...common, entryPoints: [`solid/source/${entry}.ts`], outfile: path.join(output, `solid/${entry}.js`) })
}

for (const [sourceDir, targetDir] of [
  ["src", ""],
  ["solid/source/scripts", "solid/scripts"],
]) {
  for (const file of await readdir(path.join(root, sourceDir!))) {
    if (!file.endsWith(".ts") || file.endsWith(".d.ts")) continue
    if (sourceDir === "src" && !file.startsWith("runtime-plugin")) continue
    await build({
      ...common,
      bundle: false,
      entryPoints: [path.join(sourceDir!, file)],
      outfile: path.join(output, targetDir!, file.replace(/\.ts$/, ".js")),
    })
  }
}

async function files(directory: string, prefix = ""): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name)
    if (entry.isDirectory()) found.push(...(await files(path.join(directory, entry.name), relative)))
    else found.push(relative)
  }
  return found.sort()
}

const artifacts = await files(output)
await writeFile(
  path.join(output, "renderer-artifacts.json"),
  JSON.stringify({ compiler: manifest.devDependencies.typescript, files: artifacts }, null, 2) + "\n",
)
console.log(`Built ${artifacts.length} renderer artifacts from owned TypeScript source`)
