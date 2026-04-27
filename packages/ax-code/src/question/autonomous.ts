export namespace AutonomousQuestion {
  export interface OptionLike {
    label: string
    description?: string
  }

  export interface QuestionLike {
    question?: string
    header?: string
    multiple?: boolean
    options: OptionLike[]
  }

  export type Answer = string[]
  export type Confidence = "high" | "medium" | "low"

  export interface Decision {
    answer: Answer
    confidence: Confidence
    rationale: string
  }

  const BEST_PRACTICE_MARKER =
    /\b(recommended|default|safe|standard|common|conventional|best practice|industry|simple|minimal|pragmatic|least complex)\b/i

  const RISK_MARKER =
    /\b(experimental|risky|dangerous|destructive|manual|advanced|deprecated|complex|over-?engineer|large refactor|rewrite|new abstraction|architecture layer|framework layer|plugin system|internal-only|internal codename|secret|private implementation detail)\b/i

  const AVOID_OVERENGINEERING_MARKER = new RegExp(
    "\\b(avoid|avoids|avoiding|prevent|prevents|preventing|no|without|reduce|reduces|reducing)\\s+(over-?engineer(?:ing|ed)?|complexity|complex|large refactor|rewrite)\\b",
    "i",
  )

  const AVOID_OVERENGINEERING_CONTEXT_MARKER = new RegExp(
    "\\bavoid\\s+(over-?engineer(?:ing|ed)?|complexity|complex|large refactor|rewrite)\\b",
    "i",
  )

  const NEGATIVE_CHOICE_CONTEXT_MARKER =
    /\b(should(?:\s+we)?|must|do we|to)\s+(avoid|skip|exclude|not mention)\b|\b(avoid|skip|exclude|not mention)\b.*\?/i

  const LOW_SCOPE_MARKER = /\b(targeted|focused|small|narrow|incremental|direct|reuse|existing|localized|low-risk)\b/i

  const CONTEXT_BEST_PRACTICE_MARKER =
    /\b(best|recommended|default|safe|common|industry|simple|minimal|pragmatic|least complex|over-?engineer)\b/i

  function text(option: OptionLike) {
    return `${option.label} ${option.description ?? ""}`
  }

  function questionContext(question: QuestionLike) {
    return `${question.header ?? ""} ${question.question ?? ""}`
  }

  function scoreOption(option: OptionLike, index: number, question: QuestionLike) {
    const value = text(option)
    const context = questionContext(question)
    const avoidsOverengineering = AVOID_OVERENGINEERING_MARKER.test(value)
    const contextAsksForBestPractice = CONTEXT_BEST_PRACTICE_MARKER.test(context)
    const contextAsksForNegativeChoice =
      NEGATIVE_CHOICE_CONTEXT_MARKER.test(context) && !AVOID_OVERENGINEERING_CONTEXT_MARKER.test(context)
    const isBestPractice = BEST_PRACTICE_MARKER.test(value) || avoidsOverengineering
    const isRisk = RISK_MARKER.test(value) && !avoidsOverengineering
    const isLowScope = LOW_SCOPE_MARKER.test(value)
    let score = -index / 1000
    if (contextAsksForNegativeChoice) {
      if (isRisk) score += 20
      if (isBestPractice) score -= 10
      if (isLowScope) score -= 3
      return score
    }
    if (isBestPractice) score += 10
    if (isLowScope) score += contextAsksForBestPractice ? 6 : 3
    if (isRisk) score -= 20
    return score
  }

  function confidenceFromRanked(ranked: Array<{ option: OptionLike; score: number }>, answer: Answer): Confidence {
    if (answer.length === 0 || ranked.length === 0) return "low"
    const selected = ranked.filter((entry) => answer.includes(entry.option.label)).map((entry) => entry.score)
    const rejected = ranked.filter((entry) => !answer.includes(entry.option.label)).map((entry) => entry.score)
    const lowestSelected = Math.min(...selected)
    const highestRejected = rejected[0] ?? -Infinity
    if (answer.length > 1 && lowestSelected > 0 && lowestSelected - highestRejected >= 5) return "high"
    const top = ranked[0]?.score ?? 0
    const second = ranked[1]?.score ?? 0
    if (top >= 9.5 && top - second >= 5) return "high"
    if (top > 0 && top - second >= 10) return "high"
    if (top > 0) return "medium"
    return "low"
  }

  function rationaleFor(question: QuestionLike, answer: Answer, confidence: Confidence) {
    if (answer.length === 0) return "No available options were provided."
    const contextAsksForBestPractice = CONTEXT_BEST_PRACTICE_MARKER.test(questionContext(question))
    const selected = question.options.filter((option) => answer.includes(option.label))
    const selectedText = selected.map(text).join(" ")
    if (AVOID_OVERENGINEERING_MARKER.test(selectedText))
      return `Selected an option that explicitly avoids over-engineering (${confidence} confidence).`
    if (
      NEGATIVE_CHOICE_CONTEXT_MARKER.test(questionContext(question)) &&
      !AVOID_OVERENGINEERING_CONTEXT_MARKER.test(questionContext(question))
    ) {
      return `Selected the option most aligned with the question's avoid/skip context (${confidence} confidence).`
    }
    if (BEST_PRACTICE_MARKER.test(selectedText))
      return `Selected the strongest best-practice/default signal (${confidence} confidence).`
    if (contextAsksForBestPractice && LOW_SCOPE_MARKER.test(selectedText))
      return `Selected the lowest-scope option matching the question context (${confidence} confidence).`
    if (selected.length > 0)
      return `Selected the highest-scoring option after risk and simplicity scoring (${confidence} confidence).`
    return `Selected the returned answer, but it did not match a provided option (${confidence} confidence).`
  }

  function chooseDecision(question: QuestionLike): Decision {
    if (question.options.length === 0)
      return { answer: [], confidence: "low", rationale: "No available options were provided." }
    const ranked = question.options
      .map((option, index) => ({ option, score: scoreOption(option, index, question) }))
      .sort((a, b) => b.score - a.score)

    let answer: Answer
    if (question.multiple) {
      const selected = ranked.filter((entry) => entry.score > 0)
      answer = selected.length > 0 ? selected.map((entry) => entry.option.label) : [ranked[0].option.label]
    } else {
      answer = [ranked[0].option.label]
    }
    const confidence = confidenceFromRanked(ranked, answer)
    return {
      answer,
      confidence,
      rationale: rationaleFor(question, answer, confidence),
    }
  }

  export function decisions(questions: QuestionLike[]): Decision[] {
    return questions.map(chooseDecision)
  }

  export function answers(questions: QuestionLike[]): Answer[] {
    return decisions(questions).map((decision) => decision.answer)
  }
}
