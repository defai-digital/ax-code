import { describe, expect, test } from "vitest"
import path from "path"
import { execFileSync } from "node:child_process"
import { chmod, readFile, writeFile } from "node:fs/promises"
import { logo } from "../../src/cli/logo"
import { tmpdir } from "../fixture/fixture"

const repoRoot = path.resolve(import.meta.dirname, "../../../..")
const installScript = path.join(repoRoot, "install")
const installPowerShellScript = path.join(repoRoot, "install.ps1")

describe("install script", () => {
  test("quarantines stale source launchers that shadow the packaged binary", async () => {
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain("cleanup_stale_source_launchers")
    expect(text).toContain("source_launcher_cwd")
    expect(text).toContain('AX_CODE_SOURCE_CWD="')
    expect(text).toContain("AX_CODE_SOURCE_ENTRY=")
    expect(text).toContain("/packages/ax-code/src/index-node-tui.ts")
    expect(text).toContain("node --experimental-ffi")
    expect(text).toContain("AX_CODE_SOURCE_NODE_FFI_RUNNER=")
    expect(text).toContain("node-ffi-runner.mjs")
    // Legacy source launcher detection is retained so the Node installer can
    // quarantine stale Bun-era checkout launchers that still shadow releases.
    expect(text).toContain("bun run --cwd ")
    expect(text).toContain("/packages/ax-code/src/index.ts")
    expect(text).toContain(".stale-source-")
  })

  test("quarantines stale bundled launchers whose target binary is missing", async () => {
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain("cleanup_stale_bundled_launchers")
    expect(text).toContain("bundled_launcher_target")
    expect(text).toContain(".stale-bundled-")
    expect(text).toContain("/dist/")
  })

  test("installs the complete Unix node-bundled runtime tree", async () => {
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain('INSTALL_ROOT=$(dirname "$INSTALL_DIR")')
    expect(text).toContain('INSTALL_LIB_DIR="$INSTALL_ROOT/lib"')
    expect(text).toContain('INSTALL_NODE_DIR="$INSTALL_ROOT/node"')
    expect(text).toContain('INSTALL_NODE_MODULES_DIR="$INSTALL_ROOT/node_modules"')
    expect(text).toContain("install_node_bundle_tree")
    expect(text).toContain("lib/index-node-tui.js")
    expect(text).toContain("node/bin/node")
    expect(text).toContain("node_modules")
    expect(text).toContain('cp -R "$lib_dir" "$INSTALL_LIB_DIR"')
    expect(text).toContain('cp -R "$node_dir" "$INSTALL_NODE_DIR"')
    expect(text).toContain('cp -R "$node_modules_dir" "$INSTALL_NODE_MODULES_DIR"')
    expect(text).toContain('install_node_bundle_tree "$bundle_root"')
    expect(text).toContain('write_node_bundle_launcher "${INSTALL_DIR}/ax-code"')
    expect(text).toContain('while [ -L "$script" ]; do')
    // Linux archives are tar.gz; macOS remains zip.
    expect(text).toContain('archive_ext=".tar.gz"')
    expect(text).toContain("linux-x64|linux-arm64|darwin-arm64|windows-x64|windows-arm64")
    // Node-bundled releases are glibc-only; do not rewrite to unpublished suffixes.
    expect(text).not.toContain('target="$target-baseline"')
    expect(text).not.toContain('target="$target-musl"')
    expect(text).toContain("Unsupported platform: musl/Alpine Linux")
  })

  test("selects the Minisign bootstrap binary for the Linux host architecture", async () => {
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain('case "$(uname -m)" in')
    expect(text).toContain('x86_64|amd64) minisign_arch="x86_64"')
    expect(text).toContain('aarch64|arm64) minisign_arch="aarch64"')
    expect(text).toContain('-path "*/${minisign_arch}/minisign" -print -quit')
    expect(text).not.toContain('find "$tmp_dir" -type f -name minisign | head -n 1')
    expect(text).toContain("tar --warning=no-unknown-keyword")
  })

  test("warns when the installed binary is not first on PATH", async () => {
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain("warn_path_precedence")
    expect(text).toContain("your current shell resolves ax-code to")
    expect(text).toContain("export PATH=${INSTALL_DIR}:\\$PATH")
  })

  test("links or writes PATH config for Unix installers", async () => {
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain("ensure_path_config_file")
    expect(text).toContain("link_installed_binary_on_path")
    expect(text).toContain('ln -s "${INSTALL_DIR}/ax-code" "$link_path"')
    expect(text).toContain("warn_if_not_on_current_path")
    expect(text).toContain("Open a new shell, or run: export PATH=${INSTALL_DIR}:\\$PATH")
    expect(text).not.toContain('elif [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]')
    expect(text).toContain('zsh) secondary_config_file="${ZDOTDIR:-$HOME}/.zprofile"')
    expect(text).toContain("bash_login_config_file")
    expect(text).toContain('current_shell=$(basename "${SHELL:-bash}")')
    expect(text).toContain("bash) secondary_config_file=$(bash_login_config_file || true)")
  })

  test.each([
    {
      name: "updates .bash_profile when it shadows later login files",
      existingLoginFiles: [".bash_profile", ".bash_login", ".profile"],
      expectedLoginFile: ".bash_profile",
      hasBashrc: true,
      shell: "/bin/bash",
    },
    {
      name: "updates .bash_login when no .bash_profile exists",
      existingLoginFiles: [".bash_login", ".profile"],
      expectedLoginFile: ".bash_login",
      hasBashrc: true,
      shell: "/bin/bash",
    },
    {
      name: "uses .profile when no earlier login file exists",
      existingLoginFiles: [],
      expectedLoginFile: ".profile",
      hasBashrc: true,
      shell: "/bin/bash",
    },
    {
      name: "creates .bashrc when only a login startup file exists",
      existingLoginFiles: [".bash_profile"],
      expectedLoginFile: ".bash_profile",
      hasBashrc: false,
      shell: "/bin/bash",
    },
    {
      name: "defaults to Bash when SHELL is unset",
      existingLoginFiles: [],
      expectedLoginFile: ".profile",
      hasBashrc: false,
      shell: undefined,
    },
  ])("$name", async ({ existingLoginFiles, expectedLoginFile, hasBashrc, shell }) => {
    await using tmp = await tmpdir()
    const home = tmp.path
    const fakeBinary = path.join(home, "fake-ax-code")
    const bashrc = path.join(home, ".bashrc")
    const installDir = path.join(home, ".ax-code", "bin")
    const exportLine = `export PATH=${installDir}:$PATH`

    await writeFile(fakeBinary, "#!/bin/sh\nexit 0\n")
    await chmod(fakeBinary, 0o755)
    for (const file of existingLoginFiles) await writeFile(path.join(home, file), "# existing\n")
    if (hasBashrc) await writeFile(bashrc, "# existing\n")

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      XDG_CACHE_HOME: path.join(home, ".cache"),
    }
    if (shell === undefined) delete env.SHELL
    else env.SHELL = shell

    if (shell === undefined) {
      execFileSync("bash", ["-c", 'unset SHELL; source "$1" --binary "$2"', "bash", installScript, fakeBinary], {
        env,
        stdio: "pipe",
      })
    } else {
      execFileSync("bash", [installScript, "--binary", fakeBinary], { env, stdio: "pipe" })
    }

    expect(await readFile(bashrc, "utf-8")).toContain(exportLine)
    expect(await readFile(path.join(home, expectedLoginFile), "utf-8")).toContain(exportLine)
    for (const file of existingLoginFiles) {
      if (file === expectedLoginFile) continue
      expect(await readFile(path.join(home, file), "utf-8")).not.toContain(exportLine)
    }

    const loginResult = execFileSync("bash", ["--login", "-c", "command -v ax-code"], {
      encoding: "utf-8",
      env,
    }).trim()
    expect(loginResult).toBe(path.join(installDir, "ax-code"))

    const interactiveResult = execFileSync(
      "bash",
      ["--noprofile", "--rcfile", bashrc, "-i", "-c", "command -v ax-code"],
      { encoding: "utf-8", env },
    ).trim()
    expect(interactiveResult).toBe(path.join(installDir, "ax-code"))
  })

  test("does not link ax-code into the temporary bootstrap tool cache", async () => {
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain('AX_CODE_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"')
    expect(text).toContain('"$HOME/.local/bin"|"$HOME/bin")')
    expect(text).not.toContain('"$HOME"/*) ;;')
    expect(text).toContain("cleanup_bootstrap_cache_launcher")
    expect(text).toContain('if [ "$cached_target" = "${INSTALL_DIR}/ax-code" ]')
    expect(text).not.toContain("█▀▀█ █▀▀█ █▀▀█ █▀▀▄")
  })

  test("uses the canonical AX Code startup logo", async () => {
    const text = await readFile(installScript, "utf-8")
    const block = text.match(/# AX_CODE_LOGO_START\n([\s\S]*?)# AX_CODE_LOGO_END/)?.[1]
    expect(block).toBeDefined()
    const installedLogo = [...block!.matchAll(/echo -e "\$\{MUTED\}(.*)\$\{NC\}"/g)].map((match) =>
      match[1].replaceAll("\\\\", "\\"),
    )
    expect(installedLogo).toEqual(logo)
  })

  test("resolves the latest CLI version from the releases list, not /releases/latest", async () => {
    const text = await readFile(installScript, "utf-8")
    expect(text).toContain("latest_cli_version")
    expect(text).toContain("https://api.github.com/repos/defai-digital/ax-code/releases?per_page=50")
    expect(text).toContain('"tag_name":[[:space:]]*"v[0-9]+\\.[0-9]+\\.[0-9]+"')
    expect(text).toContain(
      'url="https://github.com/defai-digital/ax-code/releases/download/v${specific_version}/$filename"',
    )
    expect(text).not.toContain("https://github.com/defai-digital/ax-code/releases/latest/download/$filename")
    expect(text).not.toContain("https://api.github.com/repos/defai-digital/ax-code/releases/latest")

    const extracted = execFileSync(
      "bash",
      [
        "-c",
        `set -euo pipefail
extract() {
  grep -oE '"tag_name":[[:space:]]*"v[0-9]+\\.[0-9]+\\.[0-9]+"' | grep -oE 'v[0-9]+\\.[0-9]+\\.[0-9]+' | sed -n 's/^v//p'
}
printf '%s' '{"tag_name":"desktop-v7.8.2","x":1},{"tag_name":"v7.8.2"}' | extract
printf '%s' '{"tag_name": "v7.8.1"}' | extract
`,
      ],
      { encoding: "utf-8" },
    )
    expect(extracted.trim().split(/\r?\n/)).toEqual(["7.8.2", "7.8.1"])
  })

  test("provides a native Windows PowerShell release installer", async () => {
    const text = await readFile(installPowerShellScript, "utf-8")
    expect(text).toContain("param(")
    expect(text).toContain("[string]$Version")
    expect(text).toContain("[string]$Binary")
    expect(text).toContain("[switch]$NoModifyPath")
    expect(text).toContain("https://api.github.com/repos/$Repo/releases?per_page=50")
    expect(text).toContain('if (-not $tag -or $tag -notmatch "^v\\d+\\.\\d+\\.\\d+$")')
    expect(text).toContain("Where-Object { [string]$_.name -eq $FileName }")
    expect(text).not.toContain("https://github.com/$Repo/releases/latest/download/$filename")
    expect(text).toContain("https://github.com/$Repo/releases/download/v$specificVersion/$filename")
    expect(text).toContain('$filename = "$App-windows-$arch.zip"')
    expect(text).toContain('return "x64"')
    expect(text).toContain('return "arm64"')
    expect(text).toContain("Expand-Archive")
    expect(text).toContain("ax-code.cmd")
    expect(text).toContain("InstallLibDir")
    expect(text).toContain("$InstallRoot = Split-Path -Parent $InstallDir")
    expect(text).toContain('$InstallLibDir = Join-Path $InstallRoot "lib"')
    expect(text).toContain('$InstallNodeDir = Join-Path $InstallRoot "node"')
    expect(text).toContain('$InstallNodeModulesDir = Join-Path $InstallRoot "node_modules"')
    expect(text).toContain("Install-NodeBundleTree")
    expect(text).toContain("Assert-NodeFfiRuntime")
    expect(text).toContain('Join-Path $InstallNodeDir "bin\\node.exe"')
    expect(text).toContain("--experimental-ffi --version")
    expect(text).toContain("Downloaded archive did not contain the bundled Node runtime")
    expect(text).toContain("Installed AX Code bundled Node runtime does not support --experimental-ffi")
    expect(text).toContain('[Environment]::SetEnvironmentVariable("Path", $newPath, "User")')
    expect(text).toContain("Assert-CurrentPathLink")
    expect(text).toContain("Get-Command ax-code")
    expect(text).toContain("ax-code is available on PATH")
    expect(text).toContain("Warn-PathPrecedence")
  })

  test("verifies Windows release archives with pinned minisign public key", async () => {
    const text = await readFile(installPowerShellScript, "utf-8")
    const bashText = await readFile(installScript, "utf-8")
    const keyMatch = bashText.match(/AX_CODE_MINISIGN_PUBLIC_KEY='([^']+)'/)
    expect(keyMatch?.[1]).toBeTruthy()
    expect(text).toContain(`$AxCodeMinisignPublicKey = "${keyMatch![1]}"`)
    expect(text).toContain("Assert-MinisignAvailable")
    expect(text).toContain("Verify-DownloadedArchive")
    expect(text).toContain("AX_CODE_SKIP_MINISIGN_VERIFY")
    expect(text).toContain("Test-SkipMinisignVerify")
    expect(text).toContain('return $env:AX_CODE_SKIP_MINISIGN_VERIFY -eq "1"')
    expect(text).toContain("skipping minisign verification because AX_CODE_SKIP_MINISIGN_VERIFY=1")
    expect(text).toContain("minisign is required to verify AX Code release artifacts")
    expect(text).toContain("scoop install minisign")
    expect(text).toContain("choco install minisign")
    expect(text).toContain("winget install jedisct1.minisign")
    expect(text).toContain('"$archive.minisig"')
    expect(text).toContain('"$($release.Url).minisig"')
    expect(text).toContain("-Vm $ArchivePath")
    expect(text).toContain("-x $SignaturePath")
    expect(text).toContain("-P $AxCodeMinisignPublicKey")
    expect(text).toContain("Verifying release signature")
    expect(text).toContain("minisign verification failed")
    // Release path must preflight minisign and verify before extract.
    const installFromRelease = text.slice(
      text.indexOf("function Install-FromRelease"),
      text.indexOf("function Get-InstalledVersion"),
    )
    expect(installFromRelease.indexOf("Assert-MinisignAvailable")).toBeLessThan(
      installFromRelease.indexOf("Resolve-ReleaseDownload"),
    )
    expect(installFromRelease.indexOf("Verify-DownloadedArchive")).toBeLessThan(
      installFromRelease.indexOf("Expand-Archive"),
    )
  })

  test("installs the Windows Node distribution without AVX2 binary fallback", async () => {
    const text = await readFile(installPowerShellScript, "utf-8")
    expect(text).toContain('$filename = "$App-windows-$arch.zip"')
    expect(text).toContain("Downloaded archive did not contain ax-code.cmd")
    expect(text).toContain("Downloaded archive did not contain the Node runtime lib directory")
    expect(text).toContain("Downloaded archive did not contain the Node runtime node_modules directory")
    expect(text).toContain("Node-bundled distribution did not contain node\\bin\\node.exe")
    expect(text).toContain("Installed ax-code node-bundled distribution from")
    expect(text).not.toContain("System.Runtime.Intrinsics.X86.Avx2")
    expect(text).not.toContain("-baseline")
  })
})
