#!/usr/bin/env bun

// src/lib/tree-sitter/assets/update.ts
import { readFile as readFile2, writeFile as writeFile2, mkdir as mkdir2, readdir } from "fs/promises";
import * as path2 from "path";

// src/lib/tree-sitter/download-utils.ts
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { createHash, randomUUID } from "node:crypto";
import * as path from "path";
var MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
var WASM_MAGIC = Buffer.from([0, 97, 115, 109]);
function grammarDownloadUrl(source) {
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error("Parser download URL is invalid");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    throw new Error("Parser download URL must be https and cannot include credentials");
  }
  return url.href;
}
async function fetchContent(source) {
  const url = grammarDownloadUrl(source);
  const response = await fetch(url, { signal: AbortSignal.timeout(3e4) });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Failed to fetch from ${source}: ${response.statusText}`);
  }
  const advertisedSize = response.headers.get("content-length");
  if (advertisedSize !== null && (!/^\d+$/.test(advertisedSize) || Number(advertisedSize) > MAX_DOWNLOAD_BYTES)) {
    await response.body.cancel();
    throw new Error("Parser download exceeds size limit");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      size += value.byteLength;
      if (size > MAX_DOWNLOAD_BYTES) throw new Error("Parser download exceeds size limit");
      chunks.push(Buffer.from(value));
    }
    if (size === 0) throw new Error("Parser download is empty");
    return Buffer.concat(chunks, size);
  } finally {
    if (!complete) await reader.cancel();
    reader.releaseLock();
  }
}
async function fetchPinnedGrammarQuery(source) {
  if (typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)) {
    throw new Error("Remote grammar queries require a SHA-256 digest");
  }
  const content = await fetchContent(source.url);
  if (createHash("sha256").update(content).digest("hex") !== source.sha256) {
    throw new Error("Grammar query SHA-256 mismatch");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(content);
}
async function writeAtomic(target, content) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
var DownloadUtils = class {
  static hashUrl(url) {
    return createHash("sha256").update(url).digest("hex");
  }
  /**
   * Download a file from URL or load from local path, with caching support
   */
  static async downloadOrLoad(source, cacheDir, cacheSubdir, fileExtension, useHashForCache = true, filetype) {
    const isUrl = source.startsWith("http://") || source.startsWith("https://");
    if (isUrl) {
      try {
        grammarDownloadUrl(source);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
      let cacheFileName;
      if (useHashForCache) {
        const hash = this.hashUrl(source);
        cacheFileName = filetype ? `${encodeURIComponent(filetype)}-${hash}${fileExtension}` : `${hash}${fileExtension}`;
      } else {
        cacheFileName = path.basename(new URL(source).pathname);
      }
      const cacheFile = path.join(cacheDir, cacheSubdir, cacheFileName);
      try {
        await mkdir(path.dirname(cacheFile), { recursive: true });
      } catch (error) {
        return { error: `Cannot create parser cache: ${error}` };
      }
      try {
        const cachedContent = await readFile(cacheFile);
        if (cachedContent.byteLength > 0) {
          console.log(`Loaded from cache: ${cacheFile} (${source})`);
          return { content: cachedContent, filePath: cacheFile };
        }
      } catch (error) {
      }
      try {
        console.log(`Downloading from URL: ${source}`);
        const content = await fetchContent(source);
        if (fileExtension === ".wasm" && !content.subarray(0, 4).equals(WASM_MAGIC)) {
          return { error: `Downloaded content from ${source} is not a valid wasm module` };
        }
        try {
          await writeAtomic(cacheFile, content);
          console.log(`Cached: ${source}`);
        } catch (cacheError) {
          console.warn(`Failed to cache: ${cacheError}`);
          return { content };
        }
        return { content, filePath: cacheFile };
      } catch (error) {
        return { error: `Error downloading from ${source}: ${error}` };
      }
    } else {
      try {
        console.log(`Loading from local path: ${source}`);
        const content = await readFile(source);
        return { content, filePath: source };
      } catch (error) {
        return { error: `Error loading from local path ${source}: ${error}` };
      }
    }
  }
  /**
   * Download and save a file to a specific target path
   */
  static async downloadToPath(source, targetPath) {
    const isUrl = source.startsWith("http://") || source.startsWith("https://");
    if (isUrl) {
      try {
        grammarDownloadUrl(source);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
    } catch (error) {
      return { error: `Cannot create download directory: ${error}` };
    }
    if (isUrl) {
      try {
        console.log(`Downloading from URL: ${source}`);
        const content = await fetchContent(source);
        if (targetPath.endsWith(".wasm") && !content.subarray(0, 4).equals(WASM_MAGIC)) {
          return { error: `Downloaded content from ${source} is not a valid wasm module` };
        }
        await writeAtomic(targetPath, content);
        console.log(`Downloaded: ${source} -> ${targetPath}`);
        return { content, filePath: targetPath };
      } catch (error) {
        return { error: `Error downloading from ${source}: ${error}` };
      }
    } else {
      try {
        console.log(`Copying from local path: ${source}`);
        const content = await readFile(source);
        await writeAtomic(targetPath, content);
        return { content, filePath: targetPath };
      } catch (error) {
        return { error: `Error copying from local path ${source}: ${error}` };
      }
    }
  }
  /**
   * Fetch multiple highlight queries and concatenate them
   */
  static async fetchHighlightQueries(sources, cacheDir, filetype) {
    const queryPromises = sources.map((source) => this.fetchHighlightQuery(source, cacheDir, filetype));
    const queryResults = await Promise.all(queryPromises);
    const validQueries = queryResults.filter((query) => query.trim().length > 0);
    return validQueries.join("\n");
  }
  static async fetchHighlightQuery(source, cacheDir, filetype) {
    const result = await this.downloadOrLoad(source, cacheDir, "queries", ".scm", true, filetype);
    if (result.error) {
      console.error(`Error fetching highlight query from ${source}:`, result.error);
      return "";
    }
    if (result.content) {
      return new TextDecoder().decode(result.content);
    }
    return "";
  }
};

// src/lib/tree-sitter/assets/update.ts
import { parseArgs } from "util";
import { fileURLToPath } from "node:url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.dirname(__filename);
function getDefaultOptions(dirname3 = __dirname) {
  const sourceDir = path2.basename(dirname3) === "tree-sitter" && path2.basename(path2.dirname(dirname3)) === "lib" ? path2.resolve(dirname3, "../../src/lib/tree-sitter") : path2.resolve(dirname3, "..");
  return {
    configPath: path2.join(sourceDir, "parsers-config"),
    assetsDir: path2.join(sourceDir, "assets"),
    outputPath: path2.join(sourceDir, "default-parsers.ts")
  };
}
async function loadConfig(configPath) {
  let ext = path2.extname(configPath);
  let resolvedConfigPath = configPath;
  if (ext === "") {
    const files = await readdir(path2.dirname(configPath));
    const basename3 = path2.basename(configPath);
    const candidates = files.filter(
      (file2) => file2.startsWith(basename3) && !file2.endsWith(".d.ts") && (file2.endsWith(".json") || file2.endsWith(".ts") || file2.endsWith(".js"))
    );
    const file = candidates.find((candidate) => [".json", ".ts", ".js"].some((suffix) => candidate === `${basename3}${suffix}`)) ?? candidates[0];
    if (!file) {
      throw new Error(`No config file found for ${configPath}`);
    }
    resolvedConfigPath = path2.join(path2.dirname(configPath), file);
    ext = path2.extname(resolvedConfigPath);
  }
  if (ext === ".json") {
    const configContent = await readFile2(resolvedConfigPath, "utf-8");
    return JSON.parse(configContent);
  } else if (ext === ".ts" || ext === ".js") {
    const { default: configContent } = await import(resolvedConfigPath);
    return configContent;
  }
  throw new Error(`Unsupported config file extension: ${ext}`);
}
function resolveFiletypeDir(assetsDir, filetype) {
  const assetsRoot = path2.resolve(assetsDir);
  const dir = path2.resolve(assetsRoot, filetype);
  if (!dir.startsWith(assetsRoot + path2.sep)) {
    throw new Error(`Filetype ${filetype} escapes the assets directory`);
  }
  return dir;
}
async function downloadLanguage(filetype, languageUrl, assetsDir, outputPath) {
  const languageDir = resolveFiletypeDir(assetsDir, filetype);
  const languageFilename = path2.basename(languageUrl);
  const languagePath = path2.join(languageDir, languageFilename);
  const result = await DownloadUtils.downloadToPath(languageUrl, languagePath);
  if (result.error) {
    throw new Error(`Failed to download language for ${filetype}: ${result.error}`);
  }
  return "./" + path2.relative(path2.dirname(outputPath), languagePath);
}
async function downloadAndCombineQueries(filetype, sources, assetsDir, outputPath, queryType, configPath) {
  const queriesDir = resolveFiletypeDir(assetsDir, filetype);
  const queryPath = path2.join(queriesDir, `${queryType}.scm`);
  const queryContents = [];
  for (const source of sources) {
    if (typeof source === "string") {
      if (!source.startsWith("./")) throw new Error("Use { url, sha256 } for remote grammar queries");
      console.log(`    Using local query: ${source}`);
      const content2 = await readFile2(path2.resolve(path2.dirname(configPath), source), "utf-8");
      if (content2.trim()) queryContents.push(content2);
      continue;
    }
    console.log("    Downloading pinned query...");
    const content = await fetchPinnedGrammarQuery(source);
    if (content.trim()) queryContents.push(`; Query from: ${source.url}
${content}`);
  }
  const combinedContent = queryContents.join("\n\n");
  await writeFile2(queryPath, combinedContent, "utf-8");
  console.log(`  Combined ${queryContents.length} queries into ${queryPath}`);
  return "./" + path2.relative(path2.dirname(outputPath), queryPath);
}
async function generateDefaultParsersFile(parsers, outputPath) {
  const assetPaths = parsers.map((parser) => {
    const safeFiletype = parser.filetype.replace(/[^a-zA-Z0-9]/g, "_");
    const lines = [
      `const ${safeFiletype}_highlights = await resolveBundledFilePath(`,
      `  () => import(${JSON.stringify(parser.highlightsPath)} as string, { with: { type: "file" } }),`,
      `  ${JSON.stringify(parser.highlightsPath)},`,
      `  import.meta.url,`,
      `)`,
      `const ${safeFiletype}_language = await resolveBundledFilePath(`,
      `  () => import(${JSON.stringify(parser.languagePath)} as string, { with: { type: "file" } }),`,
      `  ${JSON.stringify(parser.languagePath)},`,
      `  import.meta.url,`,
      `)`
    ];
    if (parser.injectionsPath) {
      lines.push(
        `const ${safeFiletype}_injections = await resolveBundledFilePath(`,
        `  () => import(${JSON.stringify(parser.injectionsPath)} as string, { with: { type: "file" } }),`,
        `  ${JSON.stringify(parser.injectionsPath)},`,
        `  import.meta.url,`,
        `)`
      );
    }
    return lines.join("\n");
  }).join("\n");
  const parserDefinitions = parsers.map((parser) => {
    const safeFiletype = parser.filetype.replace(/[^a-zA-Z0-9]/g, "_");
    const queriesLines = [`          highlights: [${safeFiletype}_highlights],`];
    if (parser.injectionsPath) {
      queriesLines.push(`          injections: [${safeFiletype}_injections],`);
    }
    const injectionMappingLine = parser.injectionMapping ? `        injectionMapping: ${JSON.stringify(parser.injectionMapping, null, 10)},` : "";
    const aliasesLine = parser.aliases?.length ? `        aliases: ${JSON.stringify(parser.aliases)},` : "";
    return `      {
        filetype: ${JSON.stringify(parser.filetype)},
${aliasesLine ? aliasesLine + "\n" : ""}        queries: {
${queriesLines.join("\n")}
        },
        wasm: ${safeFiletype}_language,${injectionMappingLine ? "\n" + injectionMappingLine : ""}
      }`;
  }).join(",\n");
  const fileContent = `// This file is generated by assets/update.ts - DO NOT EDIT MANUALLY
// Run 'bun assets/update.ts' to regenerate this file
// Last generated: ${(/* @__PURE__ */ new Date()).toISOString()}

import type { FiletypeParserOptions } from "./types.js"
import { resolveBundledFilePath } from "../../platform/runtime.js"

// Cached parsers to avoid re-resolving paths on every call
let _cachedParsers: Promise<FiletypeParserOptions[]> | undefined

export function getParsers(): Promise<FiletypeParserOptions[]> {
  if (!_cachedParsers) {
    _cachedParsers = loadParsers().catch((error) => {
      _cachedParsers = undefined
      throw error
    })
  }
  return _cachedParsers
}

async function loadParsers(): Promise<FiletypeParserOptions[]> {
${assetPaths}

  return [
${parserDefinitions},
  ]
}
`;
  await mkdir2(path2.dirname(outputPath), { recursive: true });
  await writeFile2(outputPath, fileContent, "utf-8");
  console.log(`Generated ${path2.basename(outputPath)} with ${parsers.length} parsers`);
}
async function main(options) {
  const opts = { ...getDefaultOptions(), ...options };
  try {
    console.log("Loading parsers configuration...");
    console.log(`  Config: ${opts.configPath}`);
    console.log(`  Assets Dir: ${opts.assetsDir}`);
    console.log(`  Output: ${opts.outputPath}`);
    const config = await loadConfig(opts.configPath);
    console.log(`Found ${config.parsers.length} parsers to process`);
    const generatedParsers = [];
    for (const parser of config.parsers) {
      console.log(`Processing ${parser.filetype}...`);
      console.log(`  Downloading language...`);
      const languagePath = await downloadLanguage(parser.filetype, parser.wasm, opts.assetsDir, opts.outputPath);
      console.log(`  Downloading ${parser.queries.highlights.length} highlight queries...`);
      const highlightsPath = await downloadAndCombineQueries(
        parser.filetype,
        parser.queries.highlights,
        opts.assetsDir,
        opts.outputPath,
        "highlights",
        opts.configPath
      );
      let injectionsPath;
      if (parser.queries.injections && parser.queries.injections.length > 0) {
        console.log(`  Downloading ${parser.queries.injections.length} injection queries...`);
        injectionsPath = await downloadAndCombineQueries(
          parser.filetype,
          parser.queries.injections,
          opts.assetsDir,
          opts.outputPath,
          "injections",
          opts.configPath
        );
      }
      generatedParsers.push({
        filetype: parser.filetype,
        aliases: parser.aliases,
        languagePath,
        highlightsPath,
        injectionsPath,
        injectionMapping: parser.injectionMapping
      });
      console.log(`  \u2713 Completed ${parser.filetype}`);
    }
    console.log("Generating output file...");
    await generateDefaultParsersFile(generatedParsers, opts.outputPath);
    console.log("\u2705 Update completed successfully!");
  } catch (error) {
    console.error("\u274C Update failed:", error);
    process.exit(1);
  }
}
function parseCLIArgs() {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        config: { type: "string" },
        assets: { type: "string" },
        output: { type: "string" },
        help: { type: "boolean" }
      },
      strict: true
    });
    if (values.help) {
      const command = path2.basename(Bun.argv[1] ?? "update-assets.js");
      console.log(`Usage: bun ${command} [options]

Options:
  --config <path>  Path to parsers-config.json
  --assets <path>  Directory where .wasm and .scm files will be downloaded
  --output <path>  Path where the generated TypeScript file will be written
  --help           Show this help message

Remote query entries use { "url": "https://...", "sha256": "<64 lowercase hex characters>" }.
Local query entries are paths beginning with ./.

Examples:
  # Use default paths (for AX TUI core development)
  bun ${command}

  # Use custom paths (for application integration)
  bun ${command} --config ./my-parsers.json --assets ./src/parsers --output ./src/parsers.ts
`);
      process.exit(0);
    }
    const options = {};
    if (values.config) options.configPath = path2.resolve(values.config);
    if (values.assets) options.assetsDir = path2.resolve(values.assets);
    if (values.output) options.outputPath = path2.resolve(values.output);
    return Object.keys(options).length > 0 ? options : null;
  } catch (error) {
    console.error(`Error parsing arguments: ${error}`);
    console.log("Run with --help for usage information");
    process.exit(1);
  }
}
function runUpdateAssetsCli() {
  const cliOptions = parseCLIArgs();
  return main(cliOptions || void 0);
}
if (import.meta.main) {
  await runUpdateAssetsCli();
}

// src/lib/tree-sitter/update-assets.ts
if (import.meta.main) {
  await runUpdateAssetsCli();
}
export {
  runUpdateAssetsCli,
  main as updateAssets
};
