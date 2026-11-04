import { wrapLanguageModel, type ModelMessage } from "ai"
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type { ProviderModel } from "./model-info"
import { ModelID } from "./schema"
import { ProviderTransform } from "./transform"
import { resolveModel } from "./resolved-model"
import { resolveProtocolProfile } from "./protocol-profile"
import { cloneModelData } from "./model-snapshot"

export class ModelRequestError extends Error {
  readonly isRetryable = false
  constructor(
    readonly code: "unsupported-tools" | "invalid-output-budget" | "unsupported-json",
    message: string,
  ) {
    super(message)
    this.name = "ModelRequestError"
  }
}

/** Final boundary after SDK/agent/plugin overrides, shared by primary and auxiliary calls. */
export function compileModelRequest(
  model: ProviderModel,
  input: LanguageModelV3CallOptions,
  connectionOptions: Record<string, unknown> = {},
) {
  const resolved = resolveModel(model, connectionOptions)
  const canonical = {
    ...model,
    id: ModelID.make(resolved.deployment.modelID),
    api: {
      ...model.api,
      url: typeof connectionOptions.baseURL === "string" ? connectionOptions.baseURL : model.api.url,
    },
  }
  const profile = resolveProtocolProfile(canonical)
  const params = cloneModelData(input)
  const hasTools = Boolean(params.tools?.length)
  if (hasTools && resolved.capabilities.toolCalling.state !== "supported")
    throw new ModelRequestError(
      "unsupported-tools",
      "The selected deployment has no declared tool-calling support; configure tool_call or qualify the deployment before sending tools",
    )
  if (params.responseFormat?.type === "json" && model.options?.structuredOutput === false)
    throw new ModelRequestError("unsupported-json", "The selected deployment explicitly does not support JSON output")
  if (
    params.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(params.maxOutputTokens) || params.maxOutputTokens < 1)
  )
    throw new ModelRequestError("invalid-output-budget", "maxOutputTokens must be a positive integer")
  if (params.maxOutputTokens !== undefined && model.limit.output > 0)
    params.maxOutputTokens = Math.min(params.maxOutputTokens, model.limit.output)
  const key = profile.providerOptionsKey
  const supplied = params.providerOptions?.[key] ?? {}
  const { protocolProfile: _profile, nativeReasoning: _native, structuredOutput: _json, ...flat } = supplied
  let options = ProviderTransform.sanitizeOptions(
    canonical,
    flat,
    params.toolChoice?.type === "required" || params.toolChoice?.type === "tool"
      ? "required"
      : params.toolChoice?.type === "none"
        ? "none"
        : "auto",
  )
  params.prompt = ProviderTransform.message(params.prompt as ModelMessage[], canonical, {
    ...options,
    ...(connectionOptions.compatibility ? { compatibility: connectionOptions.compatibility } : {}),
  }) as typeof params.prompt
  options = ProviderTransform.disableDeepSeekThinkingForToolHistory(
    canonical,
    options,
    params.prompt as ModelMessage[],
    hasTools,
  )
  params.providerOptions = { ...params.providerOptions, [key]: options }
  params.tools = params.tools?.map((tool) =>
    tool.type === "function"
      ? {
          ...tool,
          inputSchema: ProviderTransform.schema(canonical, tool.inputSchema),
        }
      : tool,
  )
  return { resolved, profile, params }
}

export function prepareLanguageModel<T>(
  language: T,
  model: ProviderModel,
  connectionOptions: Record<string, unknown>,
): T {
  if (
    !language ||
    typeof language !== "object" ||
    !("specificationVersion" in language) ||
    language.specificationVersion !== "v3"
  )
    return language
  const stableModel = cloneModelData(model, true)
  const stableOptions = cloneModelData(connectionOptions, true)
  return wrapLanguageModel({
    model: language as unknown as LanguageModelV3,
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => compileModelRequest(stableModel, params, stableOptions).params,
    },
  }) as T
}
