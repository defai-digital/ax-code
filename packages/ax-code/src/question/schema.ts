import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"

export type QuestionID = BrandedIdentifier<"QuestionID">

export const QuestionID = defineBrandedIdentifier("QuestionID", "question")
