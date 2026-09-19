import { AX_ENGINE_PROVIDER_ID } from "../../provider/ax-engine/constants"
import type { Provider } from "../../provider/provider"
import type { MessageV2 } from "../message-v2"
import type { SystemPrompt } from "../system"
import {
  CONVERSATION_SYSTEM_PROMPT,
  RESPONSE_ONLY_SYSTEM_PROMPT,
  textOnlyUsesFastReasoning,
  type TurnExecutionProfile,
} from "./prompt-turn-profile"

/** Task classification alone cannot qualify an API endpoint or child CLI. */
export function supportsCompactTurn(model: Pick<Provider.Model, "providerID">) {
  return model.providerID === AX_ENGINE_PROVIDER_ID
}

type TurnPromptPolicy = {
  systemProfile: SystemPrompt.Profile
  requestMessagesSource?: MessageV2.WithParts[]
  environmentOverride?: string[]
  omitTools: boolean
  fastReasoning: boolean
}

/** Keep prompt savings separate from history, tools, and reasoning decisions.
 * Non-AX providers stay unchanged until their individual behavior is qualified.
 * This policy is resolved before dispatch, never by replaying a completed turn.
 */
export function resolveTurnPromptPolicy(input: {
  model: Pick<Provider.Model, "providerID">
  user: Pick<MessageV2.User, "id" | "requestedDepth" | "variant">
  profile?: TurnExecutionProfile
}): TurnPromptPolicy {
  const profile = input.profile
  if (
    !supportsCompactTurn(input.model) ||
    !profile ||
    profile.kind === "default" ||
    profile.currentUserID !== input.user.id
  ) {
    return { systemProfile: "default", omitTools: false, fastReasoning: false }
  }
  return {
    systemProfile: "compact",
    requestMessagesSource: profile.requestMessages,
    environmentOverride: [profile.kind === "response-only" ? RESPONSE_ONLY_SYSTEM_PROMPT : CONVERSATION_SYSTEM_PROMPT],
    omitTools: true,
    fastReasoning: textOnlyUsesFastReasoning(input.user),
  }
}
