import type { NativeTarget } from "../native/index.js"

export interface BuildTarget {
  key: NativeTarget
  os: "darwin" | "linux" | "win32"
  cpu: "arm64" | "x64"
  libc?: "musl"
  zig: string
  output: string
  libFile: string
}

export const NATIVE_TARGETS: readonly BuildTarget[] = [
  {
    key: "darwin-arm64",
    os: "darwin",
    cpu: "arm64",
    zig: "aarch64-macos",
    output: "aarch64-macos",
    libFile: "libaxtui.dylib",
  },
  {
    key: "darwin-x64",
    os: "darwin",
    cpu: "x64",
    zig: "x86_64-macos",
    output: "x86_64-macos",
    libFile: "libaxtui.dylib",
  },
  {
    key: "linux-arm64",
    os: "linux",
    cpu: "arm64",
    zig: "aarch64-linux-gnu.2.17",
    output: "aarch64-linux",
    libFile: "libaxtui.so",
  },
  {
    key: "linux-x64",
    os: "linux",
    cpu: "x64",
    zig: "x86_64-linux-gnu.2.17",
    output: "x86_64-linux",
    libFile: "libaxtui.so",
  },
  {
    key: "linux-arm64-musl",
    os: "linux",
    cpu: "arm64",
    libc: "musl",
    zig: "aarch64-linux-musl",
    output: "aarch64-linux-musl",
    libFile: "libaxtui.so",
  },
  {
    key: "linux-x64-musl",
    os: "linux",
    cpu: "x64",
    libc: "musl",
    zig: "x86_64-linux-musl",
    output: "x86_64-linux-musl",
    libFile: "libaxtui.so",
  },
  {
    key: "win32-arm64",
    os: "win32",
    cpu: "arm64",
    zig: "aarch64-windows-gnu",
    output: "aarch64-windows",
    libFile: "axtui.dll",
  },
  {
    key: "win32-x64",
    os: "win32",
    cpu: "x64",
    zig: "x86_64-windows-gnu",
    output: "x86_64-windows",
    libFile: "axtui.dll",
  },
]
