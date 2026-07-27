import z from "zod"
import fs from "fs/promises"
import path from "path"
import { Tool } from "./tool"
import DESCRIPTION from "./image_gen.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import { Isolation } from "../isolation"
import { createImageProvider, type ImageProvider } from "../image"
import { abortAfterAny } from "../util/abort"
import { Filesystem } from "../util/filesystem"
import { BlastRadius } from "@/session/blast-radius"
import { FileTime } from "@/file/time"
import { assertSymlinkInsideProject } from "./external-directory"
import { notifyFileEdited } from "./diagnostics"
import { normalizeToWorkspacePath } from "./file-path"

const log = Log.create({ service: "tool.image_gen" })

const SIZES = ["1024x1024", "1536x1024", "1024x1536", "1792x1024", "1024x1792"] as const
const IMAGE_GENERATION_TIMEOUT_MS = 300_000
const OUTPUT_DIRECTORY = "generated-images"

let cachedProvider: ImageProvider | undefined
let cachedProviderKey: string | undefined

async function getProvider(): Promise<ImageProvider> {
  const cfg = await Config.get()
  const imageCfg = cfg.image_generation ?? {}
  const key = JSON.stringify(imageCfg)
  if (cachedProvider && cachedProviderKey === key) return cachedProvider
  cachedProvider = createImageProvider(imageCfg)
  cachedProviderKey = key
  return cachedProvider
}

export function resetImageProviderCacheForTests() {
  cachedProvider = undefined
  cachedProviderKey = undefined
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  return "png"
}

async function writeUniqueImage(
  directory: string,
  safeName: string,
  extension: string,
  data: Buffer,
  ctx: Tool.Context,
) {
  await fs.mkdir(directory, { recursive: true })
  await assertSymlinkInsideProject(directory)

  for (let suffix = 1; suffix <= 1_000; suffix++) {
    const filename = suffix === 1 ? `${safeName}.${extension}` : `${safeName}-${suffix}.${extension}`
    const filePath = path.join(directory, filename)
    if (!Filesystem.contains(directory, filePath)) {
      throw new Error(`Generated image path escapes its output directory: ${filePath}`)
    }
    Isolation.assertWrite(ctx.extra?.isolation, filePath, Instance.directory, Instance.worktree)
    BlastRadius.assertWritable(ctx.sessionID, normalizeToWorkspacePath(filePath, Instance.worktree))
    await assertSymlinkInsideProject(filePath)
    try {
      await fs.writeFile(filePath, data, { flag: "wx" })
      await notifyFileEdited(filePath, "add")
      await FileTime.read(ctx.sessionID, filePath)
      BlastRadius.recordWriteAndAssert(ctx.sessionID, filePath, 1)
      return filePath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue
      throw error
    }
  }

  throw new Error(`Unable to reserve a unique generated image name for "${safeName}".`)
}

export const ImageGenTool = Tool.define("image_gen", {
  description: DESCRIPTION,
  parameters: z.object({
    prompt: z.string().min(1).describe("Detailed description of the image to generate."),
    name: z.string().min(1).max(100).describe("The name of the image (used as filename, kebab-case recommended)."),
    size: z.enum(SIZES).optional().describe("The size of the generated image. Default is 1024x1024."),
  }),
  async execute(params, ctx) {
    Isolation.assertNetwork(ctx.extra?.isolation)

    const safeName = params.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80)
    const outputRoot = Instance.worktree === "/" ? Instance.directory : Instance.worktree
    const outputDirectory = path.join(outputRoot, OUTPUT_DIRECTORY)
    const expectedPath = path.join(outputDirectory, `${safeName}.png`)
    if (!Filesystem.contains(outputRoot, outputDirectory) || !Filesystem.contains(outputDirectory, expectedPath)) {
      throw new Error("Generated image path escapes the workspace.")
    }
    // Check the predictable default destination before asking for permission
    // or starting a paid request. The final extension is checked again before
    // writing in case a custom provider returns JPEG/WebP.
    Isolation.assertWrite(ctx.extra?.isolation, expectedPath, Instance.directory, Instance.worktree)
    BlastRadius.assertWritable(ctx.sessionID, normalizeToWorkspacePath(expectedPath, Instance.worktree))
    await assertSymlinkInsideProject(outputDirectory)

    await ctx.ask({
      permission: "image_gen",
      patterns: [normalizeToWorkspacePath(expectedPath, Instance.worktree)],
      always: [],
      metadata: { prompt: params.prompt.slice(0, 200) },
    })

    const provider = await getProvider()
    const size = params.size ?? "1024x1024"

    log.info("generating image", { provider: provider.id, size, name: params.name })

    const request = abortAfterAny(IMAGE_GENERATION_TIMEOUT_MS, ctx.abort)
    let result: Awaited<ReturnType<ImageProvider["generate"]>>
    try {
      result = await provider.generate({
        prompt: params.prompt,
        size,
        name: params.name,
        signal: request.signal,
      })
    } finally {
      request.clearTimeout()
    }

    ctx.abort.throwIfAborted()
    const ext = extensionForMimeType(result.mimeType)
    const filePath = await writeUniqueImage(outputDirectory, safeName, ext, result.data, ctx)
    log.info("image saved", { path: filePath, bytes: result.data.length })

    const base64 = result.data.toString("base64")

    return {
      title: `Generated image: ${params.name}`,
      metadata: {
        provider: provider.id,
        path: filePath,
        size,
        bytes: result.data.length,
        mimeType: result.mimeType,
      },
      output: `Image generated and saved to ${filePath} (${(result.data.length / 1024).toFixed(1)} KB, ${size}).\nMove it to the appropriate asset directory if needed for your project.`,
      attachments: [
        {
          type: "file" as const,
          filename: path.basename(filePath),
          mime: result.mimeType,
          url: `data:${result.mimeType};base64,${base64}`,
        },
      ],
    }
  },
})
