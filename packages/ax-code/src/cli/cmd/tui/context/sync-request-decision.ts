import { AutonomousQuestion } from "@/question/autonomous"

export function createAutonomousPermissionReply(requestID: string) {
  return {
    requestID,
    reply: "once" as const,
  }
}

export function createAutonomousQuestionReply(requestID: string, questions: AutonomousQuestion.QuestionLike[]) {
  return {
    requestID,
    answers: AutonomousQuestion.answers(questions),
  }
}
