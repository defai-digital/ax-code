import path from "path"
import { pathToFileURL } from "url"
import z from "zod"
import { Tool } from "./tool"
import { Skill } from "../skill"
import { Ripgrep } from "../file/ripgrep"
import { iife } from "@/util/iife"
import { Filesystem } from "@/util/filesystem"
import { Recorder } from "../replay/recorder"
import { Agent } from "../agent/agent"
import { SkillCatalog } from "../skill/catalog"

function escapeXmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function escapePromptMetadata(value: string) {
  return escapeXmlAttribute(value).replace(/\s+/g, " ").trim()
}

function isSkillEntrypoint(relativePath: string) {
  const normalized = relativePath.replaceAll("\\", "/")
  return normalized === "SKILL.md"
}

interface SkillMetadata {
  name?: string
  dir?: string
  total?: number
  shown?: number
  nextOffset?: number
}

export const SkillTool = Tool.define("skill", async (ctx) => {
  const list = await Skill.modelAvailable(ctx?.agent)

  const description =
    list.length === 0
      ? "Load a specialized skill that provides domain-specific instructions and workflows. No skills are currently available."
      : [
          "Load a specialized skill that provides domain-specific instructions and workflows.",
          "",
          "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
          "",
          "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
          "",
          'Tool output includes a `<skill_content name="...">` block with the loaded content.',
          "",
          "The following skills provide specialized sets of instructions for particular tasks",
          "Invoke this tool to load a skill when a task matches one of the available skills listed below:",
          "",
          Skill.fmt(list, { verbose: false }),
        ].join("\n")

  const examples = list
    .map((skill) => escapePromptMetadata(skill.name))
    .filter((name) => name.length <= 64)
    .slice(0, 3)
    .map((name) => `'${name}'`)
    .join(", ")
  const hint = examples.length > 0 ? ` (e.g., ${examples}, ...)` : ""

  const parameters = z
    .object({
      name: z.string().max(4096).optional().describe(`The name of the skill to load${hint}`),
      query: z
        .string()
        .max(256)
        .optional()
        .describe('Search eligible skill names and descriptions without loading instructions. Use "" to list all.'),
      offset: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER)
        .optional()
        .describe("Continuation offset returned by a metadata search."),
    })
    .refine(
      (input) => (input.name !== undefined) !== (input.query !== undefined),
      "Provide exactly one of name or query",
    )
    .refine((input) => input.offset === undefined || input.query !== undefined, "offset requires query")

  return {
    description: `${description}\nUse query to search or page through eligible skill metadata; use name to load instructions.`,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx): Promise<Tool.InvocationResult<SkillMetadata>> {
      const agent = await Agent.get(ctx.agent)
      if (!agent) throw new Error("Unknown agent for skill invocation")
      const eligible = await Skill.modelAvailable(agent)
      if (params.query !== undefined) {
        const matches = SkillCatalog.search(eligible, params.query)
        const page = SkillCatalog.page(matches, { verbose: false, paginate: true, offset: params.offset })
        // Discovery reveals metadata only. Existing skill permissions still apply.
        if (page.names.length)
          await ctx.ask({
            permission: "skill",
            patterns: page.names,
            always: [],
            metadata: { query: params.query },
          })
        return {
          title: "Skill metadata search",
          output: page.output,
          metadata: { total: page.total, shown: page.shown, nextOffset: page.nextOffset },
        }
      }
      const name = params.name!
      const skill = await Skill.get(name)

      if (!skill) {
        throw new Error(`Skill "${escapePromptMetadata(name)}" not found. Use query to search eligible skill metadata.`)
      }

      if (!eligible.some((entry) => entry.name === name)) {
        throw new Error(
          "Skill is not available for model invocation. A valid manual-only skill requires an explicit user slash command; do not reproduce its steps through another tool.",
        )
      }

      await ctx.ask({
        permission: "skill",
        patterns: [name],
        always: [name],
        metadata: {},
      })

      const dir = path.dirname(skill.location)
      const base = skill.builtin ? `builtin://${encodeURIComponent(skill.name)}/` : pathToFileURL(dir).href

      const limit = 10
      const sampledFiles = await iife(async () => {
        if (skill.builtin || !(await Filesystem.isDir(dir))) return []
        const arr = []
        for await (const file of Ripgrep.files({
          cwd: dir,
          follow: false,
          hidden: true,
          signal: ctx.abort,
        })) {
          if (isSkillEntrypoint(file)) {
            continue
          }
          arr.push(path.resolve(dir, file))
          if (arr.length >= limit) {
            break
          }
        }
        return arr
      })
      const files = sampledFiles.map((file) => `<file>${escapeXmlAttribute(file)}</file>`).join("\n")

      Recorder.emit({
        type: "skill.loaded",
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        skillName: skill.name,
        sourceTool: skill.sourceTool,
        scope: skill.scope,
        location: skill.location,
        builtin: skill.builtin,
        fileCount: sampledFiles.length,
      })

      const allowedToolsNote = skill.allowedTools?.length
        ? [
            `While applying this skill, restrict yourself to these tools: ${skill.allowedTools.map(escapePromptMetadata).join(", ")}.`,
            "",
          ]
        : []

      return {
        title: `Loaded skill: ${skill.name}`,
        output: [
          `<skill_content name="${escapeXmlAttribute(skill.name)}">`,
          `# Skill: ${escapePromptMetadata(skill.name)}`,
          "",
          skill.content.trim(),
          "",
          ...allowedToolsNote,
          `Base directory for this skill: ${base}`,
          "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
          "Note: file list is sampled.",
          "",
          "<skill_files>",
          files,
          "</skill_files>",
          "</skill_content>",
        ].join("\n"),
        metadata: {
          name: skill.name,
          dir: skill.builtin ? `builtin://${skill.name}` : dir,
        },
      }
    },
  }
})
