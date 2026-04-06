#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@ax-code/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  binaries[pkg.name] = pkg.version
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]

const npmName = "@defai.digital/ax-code"
const distDir = `./dist/${pkg.name}`

await $`mkdir -p ${distDir}`
await $`cp -r ./bin ${distDir}/bin`
await $`cp ./script/postinstall.mjs ${distDir}/postinstall.mjs`
await Bun.file(`${distDir}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`${distDir}/package.json`).write(
  JSON.stringify(
    {
      name: npmName,
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: version,
      license: pkg.license,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

// Publish platform-specific binaries (skip already-published versions)
const tasks = Object.entries(binaries).map(async ([name]) => {
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${name}`)
  }
  await $`pnpm pack`.cwd(`./dist/${name}`)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(`./dist/${name}`).catch((err) => {
    if (String(err).includes("previously published")) {
      console.warn(`${name}@${version} already published, skipping`)
    } else {
      throw err
    }
  })
})
await Promise.all(tasks)

// Publish @defai.digital/ax-code (skip if already published)
await $`cd ${distDir} && pnpm pack && npm publish *.tgz --access public --tag ${Script.channel}`.catch((err) => {
  if (String(err).includes("previously published")) {
    console.warn(`@defai.digital/ax-code@${version} already published, skipping`)
  } else {
    throw err
  }
})

// Docker image publish — requires buildx with multi-platform support.
// Skip gracefully in CI environments without docker buildx configured.
const image = "ghcr.io/defai-digital/ax-code"
const platforms = "linux/amd64,linux/arm64"
const tags = [`${image}:${version}`, `${image}:${Script.channel}`]
const tagFlags = tags.flatMap((t) => ["-t", t])
await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`.catch((err) => {
  console.warn("docker buildx skipped:", err instanceof Error ? err.message : String(err))
})

// registries (AUR + Homebrew) — requires all platform binaries.
// Skip if any platform archive is missing (e.g., --single builds).
if (!Script.preview) {
  const sha = async (file: string) => $`sha256sum ${file} | cut -d' ' -f1`.text().then((x) => x.trim())
  const arm64Sha = await sha("./dist/ax-code-linux-arm64.tar.gz").catch(() => "")
  const x64Sha = await sha("./dist/ax-code-linux-x64.tar.gz").catch(() => "")
  const macX64Sha = await sha("./dist/ax-code-darwin-x64.zip").catch(() => "")
  const macArm64Sha = await sha("./dist/ax-code-darwin-arm64.zip").catch(() => "")
  if (!arm64Sha || !x64Sha || !macX64Sha || !macArm64Sha) {
    console.warn("skipping AUR/Homebrew — not all platform archives present")
  } else {

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  // arch
  const binaryPkgbuild = [
    "# Maintainer: dax",
    "# Maintainer: adam",
    "",
    "pkgname='ax-code-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='Sovereign AI coding agent — provider-agnostic, LSP-first'",
    "url='https://github.com/defai-digital/ax-code'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('ax-code')",
    "conflicts=('ax-code')",
    "depends=('ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::https://github.com/defai-digital/ax-code/releases/download/v\${pkgver}\${_subver}/ax-code-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,

    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::https://github.com/defai-digital/ax-code/releases/download/v\${pkgver}\${_subver}/ax-code-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./ax-code "${pkgdir}/usr/bin/ax-code"',
    "}",
    "",
  ].join("\n")

  for (const [pkg, pkgbuild] of [["ax-code-bin", binaryPkgbuild]]) {
    for (let i = 0; i < 30; i++) {
      try {
        await $`rm -rf ./dist/aur-${pkg}`
        await $`git clone ssh://aur@aur.archlinux.org/${pkg}.git ./dist/aur-${pkg}`
        await $`cd ./dist/aur-${pkg} && git checkout master`
        await Bun.file(`./dist/aur-${pkg}/PKGBUILD`).write(pkgbuild)
        await $`cd ./dist/aur-${pkg} && makepkg --printsrcinfo > .SRCINFO`
        await $`cd ./dist/aur-${pkg} && git add PKGBUILD .SRCINFO`
        await $`cd ./dist/aur-${pkg} && git commit -m "Update to v${Script.version}"`
        await $`cd ./dist/aur-${pkg} && git push`
        break
      } catch (e) {
        continue
      }
    }
  }

  // Homebrew formula
  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# Auto-generated by publish.ts — do not edit manually.",
    "class AxCode < Formula",
    `  desc "Sovereign AI coding agent — provider-agnostic, LSP-first"`,
    `  homepage "https://github.com/defai-digital/ax-code"`,
    `  version "${Script.version.split("-")[0]}"`,
    "",
    `  depends_on "ripgrep"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "https://github.com/defai-digital/ax-code/releases/download/v${Script.version}/ax-code-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "ax-code"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "https://github.com/defai-digital/ax-code/releases/download/v${Script.version}/ax-code-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "ax-code"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/defai-digital/ax-code/releases/download/v${Script.version}/ax-code-linux-x64.tar.gz"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "ax-code"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/defai-digital/ax-code/releases/download/v${Script.version}/ax-code-linux-arm64.tar.gz"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "ax-code"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error("GITHUB_TOKEN is required to update homebrew tap")
    process.exit(1)
  }
  const tap = `https://x-access-token:${token}@github.com/defai-digital/homebrew-ax-code.git`
  await $`rm -rf ./dist/homebrew-tap`
  await $`git clone ${tap} ./dist/homebrew-tap`
  await Bun.file("./dist/homebrew-tap/ax-code.rb").write(homebrewFormula)
  await $`cd ./dist/homebrew-tap && git add ax-code.rb`
  await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
  await $`cd ./dist/homebrew-tap && git push`
  }
}
