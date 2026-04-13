export namespace AutonomousQuestion {
  export interface OptionLike {
    label: string
    description?: string
  }

  export interface QuestionLike {
    multiple?: boolean
    options: OptionLike[]
  }

  export type Answer = string[]

  const BEST_PRACTICE_MARKER = new RegExp(
    [
      "\\b(recommended|default|safe|standard|common|conventional|best practice|industry|simple|minimal|pragmatic|least complex)\\b",
      "建議|預設|推薦|最佳實務|業界|常見|簡單|最小|務實",
    ].join("|"),
    "i",
  )

  const RISK_MARKER = new RegExp(
    [
      "\\b(experimental|risky|dangerous|destructive|manual|advanced|deprecated|complex|over-?engineer|large refactor|rewrite)\\b",
      "實驗|風險|危險|破壞|手動|進階|棄用|複雜|過度工程|大重構|重寫",
    ].join("|"),
    "i",
  )

  function text(option: OptionLike) {
    return `${option.label} ${option.description ?? ""}`
  }

  function scoreOption(option: OptionLike, index: number) {
    let score = -index / 1000
    if (BEST_PRACTICE_MARKER.test(text(option))) score += 10
    if (RISK_MARKER.test(text(option))) score -= 20
    return score
  }

  function chooseAnswer(question: QuestionLike): Answer {
    if (question.options.length === 0) return []
    if (question.multiple) {
      const marked = question.options.filter((option) => BEST_PRACTICE_MARKER.test(text(option)))
      if (marked.length > 0) return marked.map((option) => option.label)
    }
    const selected = question.options
      .map((option, index) => ({ option, score: scoreOption(option, index) }))
      .sort((a, b) => b.score - a.score)[0].option
    return [selected.label]
  }

  export function answers(questions: QuestionLike[]): Answer[] {
    return questions.map(chooseAnswer)
  }
}
