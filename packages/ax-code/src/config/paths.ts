import path from "path"
import os from "os"
import * as fs from "fs/promises"
import z from "zod"
import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"
import { NamedError } from "@ax-code/util/error"
import { Filesystem } from "@/util/filesystem"
import { Env } from "@/util/env"
import { Flag } from "@/flag/flag"
import { Global } from "@/global"

export namespace ConfigPaths {
  export async function projectFiles(name: string, directory: string, worktree: string) {
    const files: string[] = []
    for (const file of [`${name}.jsonc`, `${name}.json`]) {
      const found = await Filesystem.findUp(file, directory, worktree)
      for (const resolved of found.toReversed()) {
        files.push(resolved)
      }
    }
    return files
  }

  export async function directories(directory: string, worktree: string) {
    return [
      Global.Path.config,
      ...(!Flag.AX_CODE_DISABLE_PROJECT_CONFIG
        ? await Array.fromAsync(
            Filesystem.up({
              targets: [".ax-code"],
              start: directory,
              stop: worktree,
            }),
          )
        : []),
      ...(await Array.fromAsync(
        Filesystem.up({
          targets: [".ax-code"],
          start: Global.Path.home,
          stop: Global.Path.home,
        }),
      )),
      ...(Flag.AX_CODE_CONFIG_DIR ? [Flag.AX_CODE_CONFIG_DIR] : []),
    ]
  }

  export function fileInDirectory(dir: string, name: string) {
    return [path.join(dir, `${name}.jsonc`), path.join(dir, `${name}.json`)]
  }

  export const JsonError = NamedError.create(
    "ConfigJsonError",
    z.object({
      path: z.string(),
      message: z.string().optional(),
    }),
  )

  export const InvalidError = NamedError.create(
    "ConfigInvalidError",
    z.object({
      path: z.string(),
      issues: z.custom<z.core.$ZodIssue[]>().optional(),
      message: z.string().optional(),
    }),
  )

  /** Read a config file, returning undefined for missing files and throwing JsonError for other failures. */
  export async function readFile(filepath: string) {
    return Filesystem.readText(filepath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return
      throw new JsonError({ path: filepath }, { cause: err })
    })
  }

  type ParseSource = string | { source: string; dir: string }

  function source(input: ParseSource) {
    return typeof input === "string" ? input : input.source
  }

  function dir(input: ParseSource) {
    return typeof input === "string" ? path.dirname(input) : input.dir
  }

  export type ParseOptions = {
    missing?: "error" | "empty"
    /**
     * Whether the config source is trusted. Trusted configs (user's
     * global config, managed/enterprise config, explicit env vars)
     * can resolve `{file:}` tokens to any absolute path. Untrusted
     * configs (project files in the worktree, remote well-known
     * configs, account configs fetched over the network) are
     * restricted to references inside their own config directory —
     * otherwise a malicious project config could exfiltrate
     * `{file:/etc/shadow}` or `{file:~/.ssh/id_rsa}`. Default: true
     * for backward compatibility. Callers loading project / network
     * configs must explicitly opt into `trusted: false`.
     */
    trusted?: boolean
  }

  /** Apply {env:VAR} and {file:path} substitutions to config text. */
  async function substitute(text: string, input: ParseSource, options: ParseOptions = {}) {
    const missing = options.missing ?? "error"
    const trusted = options.trusted ?? true
    // For untrusted configs (project, remote well-known, account),
    // route `{env:VAR}` substitution through the same secret-pattern
    // sanitizer as the bash tool. A malicious project config could
    // otherwise reference `{env:OPENAI_API_KEY}` and embed the
    // user's API key value into instruction text / system prompts
    // that get sent to the configured LLM provider. Trusted configs
    // (global, managed, AX_CODE_CONFIG env) still resolve any env
    // var — users control those and legitimately need to reference
    // e.g. their own custom endpoint URLs stored in env vars.
    const envSource = trusted ? process.env : Env.sanitize(process.env)
    text = text.replace(/\{env:([^}]+)\}/g, (_, varName) => {
      return envSource[varName] || ""
    })

    const fileMatches = Array.from(text.matchAll(/\{file:[^}]+\}/g))
    if (!fileMatches.length) return text

    const configDir = dir(input)
    const configSource = source(input)
    const configDirResolved = path.resolve(configDir)
    let out = ""
    let cursor = 0

    for (const match of fileMatches) {
      const token = match[0]
      const index = match.index!
      out += text.slice(cursor, index)

      const lineStart = text.lastIndexOf("\n", index - 1) + 1
      const prefix = text.slice(lineStart, index).trimStart()
      if (prefix.startsWith("//")) {
        out += token
        cursor = index + token.length
        continue
      }

      const rawRef = token.replace(/^\{file:/, "").replace(/\}$/, "")
      let filePath = rawRef
      if (filePath.startsWith("~/")) {
        // `~/` can only appear in trusted configs — an untrusted
        // project config writing `{file:~/.ssh/id_rsa}` must not be
        // allowed to escape to the user's home directory.
        if (!trusted) {
          throw new InvalidError({
            path: configSource,
            message: `file reference escapes config directory: "${token}" (untrusted configs cannot use ~/)`,
          })
        }
        filePath = path.join(os.homedir(), filePath.slice(2))
      }

      const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(configDir, filePath)

      if (!trusted) {
        // For untrusted configs, confine resolution to the config's
        // own directory. Reject absolute paths outright and resolve
        // symlinks to catch escape attempts like a relative path
        // whose target is a symlink pointing outside configDir.
        if (path.isAbsolute(rawRef)) {
          throw new InvalidError({
            path: configSource,
            message: `file reference escapes config directory: "${token}" (untrusted configs cannot use absolute paths)`,
          })
        }
        const real = await fs.realpath(resolvedPath).catch(() => resolvedPath)
        if (!Filesystem.contains(configDirResolved, real)) {
          throw new InvalidError({
            path: configSource,
            message: `file reference escapes config directory: "${token}"`,
          })
        }
      }

      const fileContent = (
        await Filesystem.readText(resolvedPath).catch((error: NodeJS.ErrnoException) => {
          if (missing === "empty") return ""

          const errMsg = `bad file reference: "${token}"`
          if (error.code === "ENOENT") {
            throw new InvalidError(
              {
                path: configSource,
                message: errMsg + ` ${resolvedPath} does not exist`,
              },
              { cause: error },
            )
          }
          throw new InvalidError({ path: configSource, message: errMsg }, { cause: error })
        })
      ).trim()

      out += JSON.stringify(fileContent).slice(1, -1)
      cursor = index + token.length
    }

    out += text.slice(cursor)
    return out
  }

  /** Substitute and parse JSONC text, throwing JsonError on syntax errors. */
  export async function parseText(
    text: string,
    input: ParseSource,
    missingOrOptions: "error" | "empty" | ParseOptions = "error",
  ) {
    // Accept legacy positional string for the `missing` argument so
    // existing callers keep working while new callers can pass the
    // full options bag (including `trusted`).
    const options: ParseOptions =
      typeof missingOrOptions === "string" ? { missing: missingOrOptions } : missingOrOptions
    const configSource = source(input)
    text = await substitute(text, input, options)

    const errors: JsoncParseError[] = []
    const data = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length) {
      const lines = text.split("\n")
      const errorDetails = errors
        .map((e) => {
          const beforeOffset = text.substring(0, e.offset).split("\n")
          const line = beforeOffset.length
          const column = beforeOffset[beforeOffset.length - 1].length + 1
          const problemLine = lines[line - 1]

          const error = `${printParseErrorCode(e.error)} at line ${line}, column ${column}`
          if (!problemLine) return error

          return `${error}\n   Line ${line}: ${problemLine}\n${"".padStart(column + 9)}^`
        })
        .join("\n")

      throw new JsonError({
        path: configSource,
        message: `\n--- JSONC Input ---\n${text}\n--- Errors ---\n${errorDetails}\n--- End ---`,
      })
    }

    return data
  }
}
