import type { ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import os from "os"
import { Global } from "../global"
import { BunProc } from "../bun"
import { text } from "node:stream/consumers"
import fs from "fs/promises"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { Archive } from "../util/archive"
import { Process } from "../util/process"
import { which } from "../util/which"
import { Module } from "@ax-code/util/module"
import { spawn } from "./launch"
import { JS_LOCKFILES } from "@/constants/lsp"
import {
  log,
  pathExists,
  run,
  output,
  NearestRoot,
} from "./server-helpers"

import * as _Defs from "./server-defs"

export namespace LSPServer {
  export interface Handle {
    process: ChildProcessWithoutNullStreams
    initialization?: Record<string, any>
  }

  export interface Info {
    id: string
    extensions: string[]
    global?: boolean
    root: (file: string) => Promise<string | undefined>
    spawn(root: string): Promise<Handle | undefined>
  }

  // Server definitions — see lsp/server-defs.ts for implementations
  export const Deno = _Defs.Deno
  export const Typescript = _Defs.Typescript
  export const Vue = _Defs.Vue
  export const ESLint = _Defs.ESLint
  export const Oxlint = _Defs.Oxlint
  export const Biome = _Defs.Biome
  export const Gopls = _Defs.Gopls
  export const Rubocop = _Defs.Rubocop
  export const Ty = _Defs.Ty
  export const Pyright = _Defs.Pyright
  export const ElixirLS = _Defs.ElixirLS
  export const Zls = _Defs.Zls
  export const CSharp = _Defs.CSharp
  export const FSharp = _Defs.FSharp
  export const SourceKit = _Defs.SourceKit
  export const RustAnalyzer = _Defs.RustAnalyzer
  export const Clangd = _Defs.Clangd
  export const Svelte = _Defs.Svelte
  export const Astro = _Defs.Astro
  export const JDTLS = _Defs.JDTLS
  export const KotlinLS = _Defs.KotlinLS
  export const YamlLS = _Defs.YamlLS
  export const LuaLS = _Defs.LuaLS
  export const PHPIntelephense = _Defs.PHPIntelephense
  export const Prisma = _Defs.Prisma
  export const Dart = _Defs.Dart
  export const Ocaml = _Defs.Ocaml
  export const BashLS = _Defs.BashLS
  export const TerraformLS = _Defs.TerraformLS
  export const TexLab = _Defs.TexLab
  export const DockerfileLS = _Defs.DockerfileLS
  export const Gleam = _Defs.Gleam
  export const Clojure = _Defs.Clojure
  export const Nixd = _Defs.Nixd
  export const Tinymist = _Defs.Tinymist
  export const HLS = _Defs.HLS
  export const JuliaLS = _Defs.JuliaLS
}
