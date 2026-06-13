import { defineBrandedString, type BrandedIdentifier } from "@/id/branded"

export type ProjectID = BrandedIdentifier<"ProjectID">

const projectID = defineBrandedString("ProjectID")

export const ProjectID = {
  ...projectID,
  global: projectID.make("global"),
} as const
