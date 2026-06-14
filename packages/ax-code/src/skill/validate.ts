import path from "path"

export namespace SkillValidate {
  export const STANDARD_SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

  export interface StandardSkillInput {
    name: string
    description: string
    location: string
    compatibility?: string
    hasInvalidMetadata: boolean
  }

  export function validateStandardSkill(input: StandardSkillInput): string[] {
    const issues: string[] = []
    const dir = path.basename(path.dirname(input.location))

    if (input.name.length > 64) issues.push("name exceeds 64 characters")
    if (!STANDARD_SKILL_NAME.test(input.name)) {
      issues.push("name should use lowercase letters, numbers, and single hyphen separators")
    }
    if (dir !== input.name) issues.push("name should match the parent directory name")
    if (input.description.length === 0) issues.push("description is empty")
    if (input.description.length > 1024) issues.push("description exceeds 1024 characters")
    if (input.compatibility !== undefined && input.compatibility.length > 500) {
      issues.push("compatibility exceeds 500 characters")
    }
    if (input.hasInvalidMetadata) issues.push("metadata should be a string-to-string map")

    return issues
  }
}
