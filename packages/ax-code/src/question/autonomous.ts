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

  const AVOID_OVERENGINEERING_MARKER = new RegExp(
    [
      "\\b(avoid|avoids|avoiding|prevent|prevents|preventing|no|without|reduce|reduces|reducing)\\s+(over-?engineer(?:ing|ed)?|complexity|complex|large refactor|rewrite)\\b",
      "避免.*(過度工程|複雜|大重構|重寫)",
    ].join("|"),
    "i",
  )

  function text(option: OptionLike) {
    return `${option.label} ${option.description ?? ""}`
  }

  function scoreOption(option: OptionLike, index: number) {
    const value = text(option)
    const avoidsOverengineering = AVOID_OVERENGINEERING_MARKER.test(value)
    let score = -index / 1000
    if (BEST_PRACTICE_MARKER.test(value) || avoidsOverengineering) score += 10
    if (RISK_MARKER.test(value) && !avoidsOverengineering) score -= 20
    return score
  }

  function chooseAnswer(question: QuestionLike): Answer {
    if (question.options.length === 0) return []
    const ranked = question.options
      .map((option, index) => ({ option, score: scoreOption(option, index) }))
      .sort((a, b) => b.score - a.score)

    if (question.multiple) {
      const selected = ranked.filter((entry) => entry.score > 0)
      if (selected.length > 0) return selected.map((entry) => entry.option.label)
    }
    const selected = ranked[0].option
    return [selected.label]
  }

  export function answers(questions: QuestionLike[]): Answer[] {
    return questions.map(chooseAnswer)
  }
}
