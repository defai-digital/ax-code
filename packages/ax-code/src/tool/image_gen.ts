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

const log = Log.create({ service: "tool.image_gen" })

const SIZES = ["1024x1024", "1792x1024", "1024x1792"] as const

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

export const ImageGenTool = Tool.define("image_gen", {
  description: DESCRIPTION,
  parameters: z.object({
    prompt: z.string().describe("Detailed description of the image to generate."),
    name: z.string().max(100).describe("The name of the image (used as filename, kebab-case recommended)."),
    size: z.enum(SIZES).optional().describe("The size of the generated image. Default is 1024x1024."),
  }),
  async execute(params, ctx) {
    Isolation.assertNetwork(ctx.extra?.isolation)

    await ctx.ask({
      permission: "image_gen",
      patterns: [params.name],
      always: [],
      metadata: { prompt: params.prompt.slice(0, 200) },
    })

    const provider = await getProvider()
    const size = params.size ?? "1024x1024"

    log.info("generating image", { provider: provider.id, size, name: params.name })

    const result = await provider.generate({
      prompt: params.prompt,
      size,
      name: params.name,
    })

    const safeName = params.name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80)
    const ext = result.mimeType === "image/jpeg" ? "jpg" : "png"
    const dir = path.join(Instance.worktree, ".ax-code", "images")
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `${safeName}.${ext}`)
    await fs.writeFile(filePath, result.data)

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
          filename: `${safeName}.${ext}`,
          mime: result.mimeType,
          url: `data:${result.mimeType};base64,${base64}`,
        },
      ],
    }
  },
})
