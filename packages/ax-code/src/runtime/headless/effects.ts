import { AutonomousQuestion } from "@/question/autonomous"
import type { HeadlessProjectionEffect } from "./projection"

export function createHeadlessAutonomousPermissionReply(requestID: string) {
  return {
    requestID,
    reply: "once" as const,
  }
}

export function createHeadlessAutonomousQuestionReply(
  requestID: string,
  questions: AutonomousQuestion.QuestionLike[],
) {
  return {
    requestID,
    answers: AutonomousQuestion.answers(questions),
  }
}

export type HeadlessProjectionEffectHandlers = {
  replyPermission?: (payload: ReturnType<typeof createHeadlessAutonomousPermissionReply>) => Promise<unknown> | unknown
  replyQuestion?: (payload: ReturnType<typeof createHeadlessAutonomousQuestionReply>) => Promise<unknown> | unknown
  syncRuntimeProbe?: (key: Extract<HeadlessProjectionEffect, { type: "runtime.probe" }>["key"]) => Promise<unknown> | unknown
  bootstrap?: () => Promise<unknown> | unknown
  onWarn: (label: string, error: unknown) => void
}

export function executeHeadlessProjectionEffect(
  effect: HeadlessProjectionEffect,
  handlers: HeadlessProjectionEffectHandlers,
) {
  switch (effect.type) {
    case "permission.auto_reply":
      return warnAsync(
        () => handlers.replyPermission?.(createHeadlessAutonomousPermissionReply(effect.requestID)),
        "autonomous permission reply failed",
        handlers.onWarn,
      )

    case "question.auto_reply":
      return warnAsync(
        () =>
          handlers.replyQuestion?.(
            createHeadlessAutonomousQuestionReply(
              effect.requestID,
              effect.questions as AutonomousQuestion.QuestionLike[],
            ),
          ),
        "autonomous question reply failed",
        handlers.onWarn,
      )

    case "runtime.probe":
      return warnAsync(() => handlers.syncRuntimeProbe?.(effect.key), "runtime probe failed", handlers.onWarn)

    case "bootstrap.reload":
      return warnAsync(() => handlers.bootstrap?.(), "bootstrap sync failed", handlers.onWarn)
  }
}

export function executeHeadlessProjectionEffects(
  effects: HeadlessProjectionEffect[],
  handlers: HeadlessProjectionEffectHandlers,
) {
  for (const effect of effects) executeHeadlessProjectionEffect(effect, handlers)
}

function warnAsync(
  action: () => Promise<unknown> | unknown,
  label: string,
  onWarn: HeadlessProjectionEffectHandlers["onWarn"],
) {
  try {
    void Promise.resolve(action()).catch((error) => onWarn(label, error))
  } catch (error) {
    onWarn(label, error)
  }
}
