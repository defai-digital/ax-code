import { Auth } from "../../auth"
import { cmd } from "./cmd"
import { GITHUB_REPO_URL } from "@/constants/project"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { getCliProviderDefinition } from "../../provider/cli/config"
import { probeCliProvider } from "../../provider/cli/connect"
import { map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import type { Hooks } from "@ax-code/plugin"
import { Process } from "../../util/process"
import { text } from "node:stream/consumers"
import { Ssrf } from "../../util/ssrf"
import { toErrorMessage } from "../../util/error-message"
import {
  AX_ENGINE_MODEL_IDS,
  getAxEngineStatus,
  normalizeModelID,
  normalizeQuantization,
  prepareAxEngine,
  stopServer,
} from "@/provider/ax-engine"

type PluginAuth = NonNullable<Hooks["auth"]>

function isHttpProviderUrl(input: string) {
  try {
    const protocol = new URL(input).protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

async function setProviderAuth(provider: string, info: Auth.Info) {
  await Auth.set(provider, info)
  await Provider.invalidate().catch(() => {})
}

async function removeProviderAuth(provider: string) {
  await Auth.remove(provider)
  await Provider.invalidate().catch(() => {})
}

function isWellKnownAuthCommand(input: unknown): input is string[] {
  return Array.isArray(input) && input.length > 0 && input.every((item) => typeof item === "string" && item.trim())
}

async function handlePluginAuth(plugin: { auth: PluginAuth }, provider: string, methodName?: string): Promise<boolean> {
  let index = 0
  if (methodName) {
    const match = plugin.auth.methods.findIndex((x) => x.label.toLowerCase() === methodName.toLowerCase())
    if (match === -1) {
      prompts.log.error(
        `Unknown method "${methodName}" for ${provider}. Available: ${plugin.auth.methods.map((x) => x.label).join(", ")}`,
      )
      process.exit(1)
    }
    index = match
  } else if (plugin.auth.methods.length > 1) {
    const method = await prompts.select({
      message: "Login method",
      options: [
        ...plugin.auth.methods.map((x, index) => ({
          label: x.label,
          value: index.toString(),
        })),
      ],
    })
    if (prompts.isCancel(method)) throw new UI.CancelledError()
    index = parseInt(method, 10)
  }
  const method = plugin.auth.methods[index]

  await new Promise((r) => setTimeout(r, 10))
  const inputs: Record<string, string> = {}
  if (method.prompts) {
    for (const prompt of method.prompts) {
      if (prompt.when) {
        const value = inputs[prompt.when.key]
        if (value === undefined) continue
        const matches = prompt.when.op === "eq" ? value === prompt.when.value : value !== prompt.when.value
        if (!matches) continue
      }
      if (prompt.condition && !prompt.condition(inputs)) continue
      if (prompt.type === "select") {
        const value = await prompts.select({
          message: prompt.message,
          options: prompt.options,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      } else {
        const value = await prompts.text({
          message: prompt.message,
          placeholder: prompt.placeholder,
          validate: prompt.validate ? (v) => prompt.validate!(v ?? "") : undefined,
        })
        if (prompts.isCancel(value)) throw new UI.CancelledError()
        inputs[prompt.key] = value
      }
    }
  }

  if (method.type === "oauth") {
    const authorize = await method.authorize(inputs)

    if (authorize.url) {
      prompts.log.info("Go to: " + authorize.url)
    }

    // Shared between the "auto" and "code" branches below. The two
    // branches used to carry byte-identical credential-saving logic;
    // when the "refresh" path gained a new discriminator field the
    // change had to be mirrored in both blocks and one lagged for a
    // release. Keep the divergent UI feedback (spinner vs log) at
    // the call sites, everything else lives here. See issue #15.
    async function saveAuthResult(
      result: Extract<Awaited<ReturnType<typeof authorize.callback>>, { type: "success" }>,
    ) {
      const saveProvider = result.provider ?? provider
      if ("refresh" in result) {
        const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
        await setProviderAuth(saveProvider, {
          type: "oauth",
          refresh,
          access,
          expires,
          ...extraFields,
        })
        return
      }
      if ("key" in result) {
        await setProviderAuth(saveProvider, {
          type: "api",
          key: result.key,
        })
      }
    }

    if (authorize.method === "auto") {
      if (authorize.instructions) {
        prompts.log.info(authorize.instructions)
      }
      const spinner = prompts.spinner()
      spinner.start("Waiting for authorization...")
      const result = await authorize.callback()
      if (result.type === "failed") {
        spinner.stop("Failed to authorize", 1)
        prompts.outro("Failed")
        return true
      }
      if (result.type === "success") {
        await saveAuthResult(result)
        spinner.stop("Login successful")
      }
    }

    if (authorize.method === "code") {
      const code = await prompts.text({
        message: "Paste the authorization code here: ",
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(code)) throw new UI.CancelledError()
      const result = await authorize.callback(code)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
        prompts.outro("Failed")
        return true
      }
      if (result.type === "success") {
        await saveAuthResult(result)
        prompts.log.success("Login successful")
      }
    }

    prompts.outro("Done")
    return true
  }

  if (method.type === "api") {
    if (method.authorize) {
      const result = await method.authorize(inputs)
      if (result.type === "failed") {
        prompts.log.error("Failed to authorize")
        prompts.outro("Failed")
        return true
      }
      if (result.type === "success") {
        const saveProvider = result.provider ?? provider
        await setProviderAuth(saveProvider, {
          type: "api",
          key: result.key,
        })
        prompts.log.success("Login successful")
      }
      prompts.outro("Done")
      return true
    }
  }

  return false
}

export function resolvePluginProviders(input: {
  hooks: Hooks[]
  existingProviders: Record<string, unknown>
  disabled: Set<string>
  enabled?: Set<string>
  providerNames: Record<string, string | undefined>
}): Array<{ id: string; name: string }> {
  const seen = new Set<string>()
  const result: Array<{ id: string; name: string }> = []

  for (const hook of input.hooks) {
    if (!hook.auth) continue
    const id = hook.auth.provider
    if (seen.has(id)) continue
    seen.add(id)
    if (Object.hasOwn(input.existingProviders, id)) continue
    if (input.disabled.has(id)) continue
    if (input.enabled && !input.enabled.has(id)) continue
    result.push({
      id,
      name: input.providerNames[id] ?? id,
    })
  }

  return result
}

export const DEFAULT_LOGIN_PROVIDER_IDS = new Set([
  "ax-code",
  "xai",
  "zai-coding-plan",
  "alibaba-coding-plan",
  "alibaba-coding-plan-cn",
  "alibaba-token-plan",
  "alibaba-token-plan-cn",
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "qoder-cli",
])

export const ProvidersCommand = cmd({
  command: "providers",
  aliases: ["auth"],
  describe: "manage AI providers and credentials",
  builder: (yargs) =>
    yargs
      .command(ProvidersListCommand)
      .command(ProvidersLoginCommand)
      .command(ProvidersLogoutCommand)
      .command(ProvidersAxEngineCommand)
      .demandCommand(),
  async handler() {},
})

function printAxEngineStatus(status: Awaited<ReturnType<typeof getAxEngineStatus>>) {
  prompts.intro("AX Engine")
  const eligibilityStatus = status.eligibility.supported ? "ok" : "blocked"
  prompts.log.info(`Eligibility: ${eligibilityStatus}`)
  for (const blocker of status.eligibility.blockers ?? []) prompts.log.error(blocker)
  for (const warning of status.eligibility.warnings ?? []) prompts.log.warn(warning)

  prompts.log.info(
    `Dependency: ${status.dependency.available ? status.dependency.binaryPath : "missing"}${
      status.dependency.version ? ` (${status.dependency.version})` : ""
    }`,
  )
  for (const blocker of status.dependency.blockers ?? []) prompts.log.error(blocker)

  prompts.log.info(
    `Disk: ${status.disk.ok ? "ok" : "blocked"}${
      status.disk.freeBytes ? ` (${Math.floor(status.disk.freeBytes / 1024 ** 3)} GiB free)` : ""
    }`,
  )
  for (const blocker of status.disk.blockers ?? []) prompts.log.error(blocker)

  prompts.log.info(`Model: ${status.model.present ? status.model.path : "not prepared"}`)
  for (const blocker of status.model.blockers ?? []) prompts.log.error(blocker)

  prompts.log.info(
    `Server: ${status.server.ready ? status.server.state?.baseURL : status.server.running ? "running but not ready" : "stopped"}`,
  )
  for (const blocker of status.server.blockers ?? []) prompts.log.warn(blocker)

  if (!status.capability.toolcall && status.capability.reason) prompts.log.warn(status.capability.reason)
  prompts.outro("Done")
}

export const ProvidersAxEngineCommand = cmd({
  command: "ax-engine <action>",
  describe: "manage the experimental AX Engine local provider",
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "action to run",
        choices: ["status", "prepare", "start", "stop"] as const,
      })
      .option("json", {
        describe: "print JSON output",
        type: "boolean",
      })
      .option("model-path", {
        describe: "existing AX Engine MLX model directory to mark as prepared",
        type: "string",
      })
      .option("model", {
        describe: "AX Engine model to prepare",
        choices: AX_ENGINE_MODEL_IDS,
      })
      .option("binary-path", {
        describe: "ax-engine CLI path",
        type: "string",
      })
      .option("quantization", {
        describe: "MLX quantization to prepare",
        choices: ["mlx4bit", "mlx6bit"] as const,
      })
      .option("download", {
        describe: "download the model through `ax-engine download`",
        type: "boolean",
      })
      .option("start", {
        describe: "start ax-engine and wait for readiness after preparation",
        type: "boolean",
      }),
  async handler(args) {
    const action = args.action
    const options = {
      binaryPath: args.binaryPath,
      modelID: args.model,
      modelPath: args.modelPath,
      quantization: args.quantization,
    }

    if (action === "status") {
      const status = await getAxEngineStatus(options)
      if (args.json) console.log(JSON.stringify(status, null, 2))
      else printAxEngineStatus(status)
      return
    }

    if (action === "stop") {
      await stopServer()
      await Provider.invalidate().catch(() => {})
      if (args.json) console.log(JSON.stringify({ stopped: true }, null, 2))
      else prompts.outro("AX Engine server stopped")
      return
    }

    if (action === "prepare") {
      const modelID = normalizeModelID(args.model)
      const quantization = normalizeQuantization(args.quantization, modelID)
      const result = await prepareAxEngine({
        modelID,
        binaryPath: args.binaryPath,
        modelPath: args.modelPath,
        quantization,
        download: args.download,
        start: args.start,
      })
      await Provider.invalidate().catch(() => {})
      if (args.json) console.log(JSON.stringify(result, null, 2))
      else {
        prompts.intro("AX Engine prepare")
        if (result.model.present) prompts.log.success(`Model prepared at ${result.model.path}`)
        else prompts.log.warn("Model is not prepared. Re-run with --model-path <dir> or --download.")
        if (result.server) prompts.log.success(`Server ready at ${result.server.baseURL}`)
        prompts.outro("Done")
      }
      return
    }

    if (action === "start") {
      const modelID = normalizeModelID(args.model)
      const quantization = normalizeQuantization(args.quantization, modelID)
      const result = await prepareAxEngine({
        modelID,
        binaryPath: args.binaryPath,
        modelPath: args.modelPath,
        quantization,
        download: args.download,
        start: true,
      })
      await Provider.invalidate().catch(() => {})
      if (args.json) console.log(JSON.stringify(result, null, 2))
      else {
        prompts.intro("AX Engine start")
        prompts.log.success(`Model ready at ${result.model.path}`)
        if (result.server) prompts.log.success(`Server ready at ${result.server.baseURL}`)
        prompts.outro("Done")
      }
      return
    }
  },
})

export const ProvidersListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers and credentials",
  async handler(_args) {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = Object.entries(await Auth.all())
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      const type =
        getCliProviderDefinition(providerID) && result.type === "api" && result.key === "cli" ? "cli" : result.type
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${type}`)
    }

    prompts.outro(`${results.length} credentials`)

    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  },
})

export const ProvidersLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "ax-code auth provider",
        type: "string",
      })
      .option("provider", {
        alias: ["p"],
        describe: "provider id or name to log in to (skips provider selection)",
        type: "string",
      })
      .option("method", {
        alias: ["m"],
        describe: "login method label (skips method selection)",
        type: "string",
      }),
  async handler(args) {
    UI.empty()
    prompts.intro("Add credential")

    // Fast path: positional arg used as provider name (not a URL)
    const directProvider = args.url && !isHttpProviderUrl(args.url) ? args.url : undefined
    if (directProvider) {
      const provider = directProvider
      const key = await prompts.password({
        message: `Enter API key for ${provider}`,
        validate: (x) => (x && x.length > 0 ? undefined : "Required"),
      })
      if (prompts.isCancel(key)) throw new UI.CancelledError()
      await setProviderAuth(provider, { type: "api", key })
      prompts.outro("Done")
      return
    }

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (args.url) {
          const url = args.url.replace(/\/+$/, "")
          const endpoint = `${url}/.well-known/ax-code`
          let res: Response
          try {
            await Ssrf.assertPublicUrl(endpoint, "providers-add")
            res = await Ssrf.pinnedFetch(endpoint, { signal: AbortSignal.timeout(10_000) })
          } catch (err) {
            prompts.log.error(`Failed to reach ${url}: ${toErrorMessage(err)}`)
            prompts.outro("Done")
            return
          }
          if (!res.ok) {
            prompts.log.error(`Failed to fetch well-known config: HTTP ${res.status}`)
            prompts.outro("Done")
            return
          }
          let wellknown: Record<string, any>
          try {
            wellknown = (await res.json()) as Record<string, any>
          } catch {
            prompts.log.error("Well-known config returned invalid JSON")
            prompts.outro("Done")
            return
          }
          if (!isWellKnownAuthCommand(wellknown?.auth?.command)) {
            prompts.log.error("Well-known config has missing or invalid auth.command (expected non-empty string array)")
            prompts.outro("Done")
            return
          }
          if (typeof wellknown.auth.env !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(wellknown.auth.env)) {
            prompts.log.error("Well-known config has missing or invalid auth.env (expected uppercase env var name)")
            prompts.outro("Done")
            return
          }
          const confirmed = await prompts.confirm({
            message: `Run authentication command: ${wellknown.auth.command.join(" ")}?`,
          })
          if (prompts.isCancel(confirmed) || !confirmed) {
            prompts.outro("Aborted")
            return
          }
          prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
          const proc = Process.spawn(wellknown.auth.command, {
            stdout: "pipe",
            stderr: "pipe",
          })
          if (!proc.stdout) {
            prompts.log.error("Auth command failed to start")
            prompts.outro("Done")
            return
          }
          let timeout: ReturnType<typeof setTimeout> | undefined
          let timeoutKill: Promise<void> = Promise.resolve()
          const timeoutResult = new Promise<null>((resolve) => {
            timeout = setTimeout(() => {
              timeoutKill = Process.killProcessTree(proc).catch(() => undefined)
              resolve(null)
            }, 30_000)
          })
          let result: [number, string, string] | null = null

          try {
            result = await Promise.race([
              Promise.all([proc.exited, text(proc.stdout), proc.stderr ? text(proc.stderr) : Promise.resolve("")]),
              timeoutResult,
            ])
          } finally {
            if (timeout) clearTimeout(timeout)
          }
          if (result === null) {
            await timeoutKill
            prompts.log.error("Auth command timed out after 30000ms")
            prompts.outro("Done")
            return
          }
          const [exit, token, stderr] = result
          if (exit !== 0) {
            prompts.log.error(`Auth command failed (exit ${exit})${stderr ? ": " + stderr.trim() : ""}`)
            prompts.outro("Done")
            return
          }
          const trimmedToken = token.trim()
          if (!trimmedToken) {
            prompts.log.error("Auth command returned an empty token")
            prompts.outro("Done")
            return
          }
          await setProviderAuth(url, {
            type: "wellknown",
            key: wellknown.auth.env,
            token: trimmedToken,
          })
          prompts.log.success("Logged into " + url)
          prompts.outro("Done")
          return
        }
        const config = await Config.get()

        // Only show providers with bundled SDK support (+ any user-enabled via config)
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const providers = await ModelsDev.get().then((x) => {
          const filtered: Record<string, (typeof x)[string]> = {}
          for (const [key, value] of Object.entries(x)) {
            const allowed = enabled ? enabled.has(key) : DEFAULT_LOGIN_PROVIDER_IDS.has(key)
            if (allowed && !disabled.has(key)) {
              filtered[key] = value
            }
          }
          return filtered
        })

        const priority: Record<string, number> = {
          "ax-code": 0,
          google: 1,
          xai: 2,
          "grok-build-cli": 3,
        }
        const pluginProviders = resolvePluginProviders({
          hooks: await Plugin.list(),
          existingProviders: providers,
          disabled,
          enabled,
          providerNames: Object.fromEntries(Object.entries(config.provider ?? {}).map(([id, p]) => [id, p.name])),
        })
        const options = [
          ...pipe(
            providers,
            values(),
            sortBy(
              (x) => priority[x.id] ?? 99,
              (x) => x.name ?? x.id,
            ),
            map((x) => ({
              label: x.name,
              value: x.id,
              hint: {
                "ax-code": "recommended",
                openai: "ChatGPT Plus/Pro or API key",
              }[x.id],
            })),
          ),
          ...pluginProviders.map((x) => ({
            label: x.name,
            value: x.id,
            hint: "plugin",
          })),
        ]

        let provider: string
        if (args.provider) {
          const input = args.provider
          const byID = options.find((x) => x.value === input)
          const byName = options.find((x) => x.label.toLowerCase() === input.toLowerCase())
          const match = byID ?? byName
          if (!match) {
            prompts.log.error(`Unknown provider "${input}"`)
            process.exit(1)
          }
          provider = match.value
        } else {
          const selected = await prompts.autocomplete({
            message: "Select provider",
            maxItems: 8,
            options: [
              ...options,
              {
                value: "other",
                label: "Other",
              },
            ],
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          provider = selected as string
        }

        // Cache the plugin list once for this login flow. Both the
        // initial provider lookup and the custom-provider fallback
        // iterate the same set; no plugin can be installed between
        // the two calls, so a re-read would just repeat the
        // filesystem scan. See issue #16.
        const plugins = await Plugin.list()
        const plugin = plugins.findLast((x) => x.auth?.provider === provider)
        if (plugin && plugin.auth) {
          const handled = await handlePluginAuth({ auth: plugin.auth }, provider, args.method)
          if (handled) return
        }

        if (provider === "other") {
          const custom = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(custom)) throw new UI.CancelledError()
          provider = custom.replace(/^@ai-sdk\//, "")

          const customPlugin = plugins.findLast((x) => x.auth?.provider === provider)
          if (customPlugin && customPlugin.auth) {
            const handled = await handlePluginAuth({ auth: customPlugin.auth }, provider, args.method)
            if (handled) return
          }

          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need to configure it in ax-code.json, check the docs for examples.`,
          )
        }

        const cliProvider = getCliProviderDefinition(provider)
        if (cliProvider) {
          const result = await probeCliProvider(provider).catch((error) => {
            prompts.log.error(toErrorMessage(error))
            return undefined
          })
          if (!result) {
            prompts.outro("Done")
            return
          }
          await setProviderAuth(provider, {
            type: "api",
            key: "cli",
          })
          prompts.log.success("Login successful")
          prompts.outro("Done")
          return
        }

        if (provider === "ax-code") {
          prompts.log.info("Create an api key in your provider's dashboard")
        }

        if (["cloudflare", "cloudflare-ai-gateway"].includes(provider)) {
          prompts.log.info(
            `Cloudflare AI Gateway can be configured with CLOUDFLARE_GATEWAY_ID, CLOUDFLARE_ACCOUNT_ID, and CLOUDFLARE_API_TOKEN environment variables. Read more: ${GITHUB_REPO_URL}`,
          )
        }

        const key = await prompts.password({
          message: "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()
        await setProviderAuth(provider, {
          type: "api",
          key,
        })

        prompts.outro("Done")
      },
    })
  },
})

export const ProvidersLogoutCommand = cmd({
  command: "logout [provider]",
  describe: "log out from a configured provider",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        describe: "provider id to log out from",
        type: "string",
      })
      .option("provider", {
        alias: ["p"],
        describe: "provider id to log out from",
        type: "string",
      }),
  async handler(args) {
    UI.empty()
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")
    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    const database = await ModelsDev.get()
    const requestedProvider = args.provider
    let providerID: string
    if (requestedProvider) {
      const match = credentials.find(([key]) => key === requestedProvider)
      if (!match) {
        prompts.log.error(`No credential found for ${requestedProvider}`)
        return
      }
      providerID = match[0]
    } else {
      if (!process.stdin.isTTY) {
        prompts.log.error(
          "Provider is required in non-interactive mode. Use `ax-code providers logout --provider <id>`.",
        )
        return
      }
      const selected = await prompts.select({
        message: "Select provider",
        options: credentials.map(([key, value]) => ({
          label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
          value: key,
        })),
      })
      if (prompts.isCancel(selected)) throw new UI.CancelledError()
      providerID = selected
    }
    await removeProviderAuth(providerID)
    prompts.outro("Logout successful")
  },
})
