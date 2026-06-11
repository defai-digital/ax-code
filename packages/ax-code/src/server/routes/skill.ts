import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { HTTPException } from "hono/http-exception"
import { validator } from "../validation"
import { Skill } from "@/skill"
import {
  buildSkillDoctorReport,
  buildSkillTriggerReport,
  buildSkillValidationReport,
  createSkill,
  SkillCreateRequest,
  SkillCreateResult,
  SkillDoctorReport,
  SkillExistsError,
  SkillInputError,
  SkillPathError,
  SkillTriggerReport,
  SkillTriggerRequest,
  SkillValidationReport,
} from "@/skill/authoring"
import { lazy } from "@/util/lazy"
import { errors } from "../error"

export const SkillRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List skills",
        description: "Get a list of all available skills in the ax-code system.",
        operationId: "app.skills",
        responses: {
          200: {
            description: "List of skills",
            content: {
              "application/json": {
                schema: resolver(Skill.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const skills = await Skill.all()
        return c.json(skills)
      },
    )
    .get(
      "/validate",
      describeRoute({
        summary: "Validate skills",
        description: "Validate discovered skills against the Agent Skills standard.",
        operationId: "skill.validate",
        responses: {
          200: {
            description: "Skill validation report",
            content: {
              "application/json": {
                schema: resolver(SkillValidationReport),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(buildSkillValidationReport(await Skill.all()))
      },
    )
    .get(
      "/doctor",
      describeRoute({
        summary: "Diagnose skills",
        description: "Diagnose discovered skills, source breakdown, and compatibility metadata.",
        operationId: "skill.doctor",
        responses: {
          200: {
            description: "Skill doctor report",
            content: {
              "application/json": {
                schema: resolver(SkillDoctorReport),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(buildSkillDoctorReport(await Skill.all()))
      },
    )
    .post(
      "/test-trigger",
      describeRoute({
        summary: "Test skill triggers",
        description: "Show which skills would be recommended for the given file paths.",
        operationId: "skill.testTrigger",
        responses: {
          200: {
            description: "Skill trigger report",
            content: {
              "application/json": {
                schema: resolver(SkillTriggerReport),
              },
            },
          },
        },
      }),
      validator("json", SkillTriggerRequest),
      async (c) => {
        const { files } = c.req.valid("json")
        return c.json(buildSkillTriggerReport(await Skill.all(), files.filter(Boolean)))
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create skill",
        description: "Create a local Agent Skill skeleton in the current worktree.",
        operationId: "skill.create",
        responses: {
          200: {
            description: "Created skill",
            content: {
              "application/json": {
                schema: resolver(SkillCreateResult),
              },
            },
          },
          ...errors(400, 409),
        },
      }),
      validator("json", SkillCreateRequest),
      async (c) => {
        try {
          return c.json(await createSkill(c.req.valid("json")))
        } catch (error) {
          if (error instanceof SkillExistsError) throw new HTTPException(409, { message: error.message })
          if (error instanceof SkillPathError || error instanceof SkillInputError) {
            throw new HTTPException(400, { message: error.message })
          }
          throw error
        }
      },
    ),
)
