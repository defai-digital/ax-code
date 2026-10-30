// src/lib/tree-sitter/parser.worker.ts
import { Parser, Query, Language } from "web-tree-sitter";
import { mkdir as mkdir3 } from "fs/promises";
import * as path2 from "path";

// src/lib/tree-sitter/download-utils.ts
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { createHash, randomUUID } from "node:crypto";
import * as path from "path";
var MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
async function fetchContent(source) {
  const response = await fetch(source, { signal: AbortSignal.timeout(3e4) });
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
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
    } catch (error) {
      return { error: `Cannot create download directory: ${error}` };
    }
    if (isUrl) {
      try {
        console.log(`Downloading from URL: ${source}`);
        const content = await fetchContent(source);
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

// src/lib/bunfs.ts
import { basename as basename2, join as join2 } from "node:path";
function isBunfsPath(path3) {
  return path3.includes("$bunfs") || /^B:[\\/]~BUN/i.test(path3);
}
function getBunfsRootPath() {
  return process.platform === "win32" ? "B:\\~BUN\\root" : "/$bunfs/root";
}
function normalizeBunfsPath(fileName) {
  return join2(getBunfsRootPath(), basename2(fileName));
}

// src/platform/runtime.ts
import { existsSync } from "node:fs";
import { mkdir as mkdir2, writeFile as writeFileNode } from "node:fs/promises";
import { dirname as dirname2, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import stringWidthLib from "string-width";
import stripAnsiLib from "strip-ansi";
var TEXT_ENCODER = new TextEncoder();
var bun = globalThis.Bun;
var sleep = bun?.sleep ?? standardSleep;
var stringWidth = bun?.stringWidth ?? stringWidthLib;
var stripANSI = bun?.stripANSI ?? stripAnsiLib;
var writeFile2 = bun?.write ?? writeFilePortable;
async function resolveBundledFilePath(loadBundledFile, fallbackPath, metaUrl) {
  if (!bun) {
    const path3 = resolveFallbackFilePath(fallbackPath, metaUrl);
    if (existsSync(path3)) {
      return path3;
    }
    return await loadBundledFilePath(loadBundledFile, metaUrl) ?? path3;
  }
  return normalizeLoadedFilePath((await loadBundledFile()).default, metaUrl);
}
function resolveFallbackFilePath(fallbackPath, metaUrl) {
  const path3 = typeof fallbackPath === "function" ? fallbackPath() : fallbackPath;
  return fileURLToPath(path3 instanceof URL ? path3 : new URL(path3, metaUrl));
}
function normalizeLoadedFilePath(loadedPath, baseUrl) {
  if (loadedPath.startsWith("file:")) {
    return fileURLToPath(loadedPath);
  }
  if (isAbsolute(loadedPath)) {
    return loadedPath;
  }
  return resolve(dirname2(fileURLToPath(baseUrl)), loadedPath);
}
async function loadBundledFilePath(loadBundledFile, metaUrl) {
  const specifier = extractBundledImportSpecifier(loadBundledFile);
  if (!specifier) {
    return void 0;
  }
  try {
    const moduleUrl = new URL(specifier, metaUrl);
    const loaded = await import(moduleUrl.href);
    return normalizeLoadedFilePath(loaded.default, moduleUrl.href);
  } catch {
    return void 0;
  }
}
function extractBundledImportSpecifier(loadBundledFile) {
  const match = String(loadBundledFile).match(/\bimport\(\s*(["'`])([^"'`]+)\1/);
  return match?.[2];
}
function standardSleep(msOrDate) {
  const ms = msOrDate instanceof Date ? msOrDate.getTime() - Date.now() : msOrDate;
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
async function writeFilePortable(destination, data, options) {
  const destinationPath = destination instanceof URL ? fileURLToPath(destination) : destination;
  if (options?.createPath) {
    await mkdir2(dirname2(destinationPath), { recursive: true });
  }
  const bytes = typeof data === "string" ? TEXT_ENCODER.encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  await writeFileNode(destinationPath, bytes, { mode: options?.mode });
  return bytes.byteLength;
}

// src/platform/worker.ts
var WORKER_UNAVAILABLE = "AX TUI tree-sitter workers are not available for this runtime yet.";
var globalWithWorker = globalThis;
var nodeWorkerThreads = getBuiltinModule("node:worker_threads");
var runtimeBridge = loadWorkerRuntime(nodeWorkerThreads);
var UnsupportedWorker = class {
  onmessage = null;
  onerror = null;
  constructor() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  postMessage() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  terminate() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  addEventListener() {
    throw new Error(WORKER_UNAVAILABLE);
  }
  removeEventListener() {
    throw new Error(WORKER_UNAVAILABLE);
  }
};
var Worker = loadWorkerConstructor();
var isWorkerRuntime = runtimeBridge !== void 0;
function postWorkerMessage(value) {
  if (!runtimeBridge) {
    throw new Error(WORKER_UNAVAILABLE);
  }
  runtimeBridge.postMessage(value);
}
function setWorkerMessageHandler(handler) {
  if (!runtimeBridge) {
    throw new Error(WORKER_UNAVAILABLE);
  }
  return runtimeBridge.setMessageHandler(handler);
}
function getBuiltinModule(id) {
  if (typeof process === "undefined") {
    return void 0;
  }
  const loader = process.getBuiltinModule;
  if (typeof loader !== "function") {
    return void 0;
  }
  try {
    return loader(id);
  } catch {
    return void 0;
  }
}
function loadWorkerConstructor() {
  if (typeof globalWithWorker.Worker === "function") {
    return globalWithWorker.Worker;
  }
  if (nodeWorkerThreads) {
    return createNodeWorkerConstructor(nodeWorkerThreads);
  }
  return UnsupportedWorker;
}
function createNodeWorkerConstructor(node) {
  return class NodeWorkerShim {
    onmessage = null;
    onerror = null;
    errorListeners = /* @__PURE__ */ new Set();
    messageListeners = /* @__PURE__ */ new Set();
    worker;
    terminationPromise;
    errorReported = false;
    constructor(specifier, options = {}) {
      const resolvedSpecifier = resolveWorkerImportSpecifier(specifier);
      this.worker = new node.Worker(createWorkerBootstrapSource(resolvedSpecifier), {
        eval: true,
        type: "module",
        name: options.name
      });
      this.worker.on("message", this.handleMessage);
      this.worker.on("error", this.handleError);
      this.worker.on("exit", this.handleExit);
    }
    postMessage(value) {
      this.worker.postMessage(value);
    }
    terminate() {
      if (this.terminationPromise) {
        return this.terminationPromise;
      }
      this.worker.off("message", this.handleMessage);
      this.worker.off("error", this.handleError);
      this.worker.off("exit", this.handleExit);
      const termination = this.worker.terminate().catch((error) => {
        this.terminationPromise = void 0;
        this.worker.on("message", this.handleMessage);
        this.worker.on("error", this.handleError);
        this.worker.on("exit", this.handleExit);
        throw error;
      });
      this.terminationPromise = termination;
      return termination;
    }
    addEventListener(type, listener) {
      if (type === "message") {
        this.messageListeners.add(listener);
        return;
      }
      this.errorListeners.add(listener);
    }
    removeEventListener(type, listener) {
      if (type === "message") {
        this.messageListeners.delete(listener);
        return;
      }
      this.errorListeners.delete(listener);
    }
    handleMessage = (data) => {
      const event = { data };
      this.onmessage?.(event);
      for (const listener of this.messageListeners) {
        listener(event);
      }
    };
    handleError = (error) => {
      if (this.errorReported) return;
      this.errorReported = true;
      const event = {
        error,
        message: error.message
      };
      this.onerror?.(event);
      for (const listener of this.errorListeners) {
        listener(event);
      }
    };
    // The bootstrap keeps the worker's event loop alive, so any exit while the
    // listeners are attached is unexpected (process.exit, OOM kill, signal).
    // Node only emits "error" for uncaught exceptions; without this the parent
    // would wait on pending requests forever.
    handleExit = (code) => {
      this.handleError(new Error(`Worker exited unexpectedly with code ${code}`));
    };
  };
}
function createWorkerBootstrapSource(specifier) {
  return `
    import { parentPort } from "node:worker_threads"

    const pendingMessages = []
    let messageHandler = null

    globalThis.self ??= globalThis
    globalThis.postMessage ??= (value) => parentPort?.postMessage(value)
    globalThis.__axCodeTuiWorkerMessageBridge = true
    Object.defineProperty(globalThis, "onmessage", {
      configurable: true,
      get: () => messageHandler,
      set: (handler) => {
        messageHandler = typeof handler === "function" ? handler : null
        if (!messageHandler) return

        const messages = pendingMessages.splice(0)
        for (const data of messages) {
          messageHandler({ data })
        }
      },
    })
    parentPort?.on("message", (data) => {
      if (messageHandler) {
        messageHandler({ data })
      } else {
        pendingMessages.push(data)
      }
    })

    await import(${JSON.stringify(specifier)})
  `;
}
function resolveWorkerImportSpecifier(specifier) {
  if (specifier instanceof URL) {
    return specifier.href;
  }
  if (isRuntimeSpecifier(specifier)) {
    return specifier;
  }
  const nodePath = getBuiltinModule("node:path");
  const nodeUrl = getBuiltinModule("node:url");
  if (!nodePath || !nodeUrl) {
    throw new Error(WORKER_UNAVAILABLE);
  }
  const absolutePath = nodePath.isAbsolute(specifier) ? specifier : nodePath.resolve(specifier);
  return nodeUrl.pathToFileURL(absolutePath).href;
}
function isRuntimeSpecifier(specifier) {
  return specifier.startsWith("file:") || specifier.startsWith("data:") || specifier.startsWith("node:") || specifier.startsWith("http:") || specifier.startsWith("https:");
}
function loadWorkerRuntime(node) {
  if (node?.parentPort && node.isMainThread === false) {
    if (globalWithWorker.__axCodeTuiWorkerMessageBridge) {
      return createGlobalWorkerRuntimeBridge();
    }
    return {
      postMessage(value) {
        node.parentPort?.postMessage(value);
      },
      setMessageHandler(handler) {
        const listener = (data) => {
          void handler({ data });
        };
        node.parentPort?.on("message", listener);
        return () => {
          node.parentPort?.off("message", listener);
        };
      }
    };
  }
  if (!isGlobalWorkerRuntime()) {
    return void 0;
  }
  return createGlobalWorkerRuntimeBridge();
}
function createGlobalWorkerRuntimeBridge() {
  let currentRegistration;
  return {
    postMessage(value) {
      globalWithWorker.postMessage?.(value);
    },
    setMessageHandler(handler) {
      const previousHandler = getGlobalWorkerMessageHandler();
      if (currentRegistration && previousHandler !== currentRegistration.listener) {
        currentRegistration = void 0;
      }
      const listener = (event) => {
        const normalizedEvent = normalizeWorkerMessageEvent(event);
        void handler(normalizedEvent);
      };
      const registration = {
        active: true,
        fallbackHandler: currentRegistration ? currentRegistration.fallbackHandler : previousHandler,
        listener,
        previous: currentRegistration
      };
      currentRegistration = registration;
      setGlobalWorkerMessageHandler(listener);
      return () => {
        registration.active = false;
        if (currentRegistration !== registration || getGlobalWorkerMessageHandler() !== listener) {
          return;
        }
        let previous = registration.previous;
        while (previous && !previous.active) {
          previous = previous.previous;
        }
        currentRegistration = previous;
        setGlobalWorkerMessageHandler(previous?.listener ?? registration.fallbackHandler);
      };
    }
  };
}
function isGlobalWorkerRuntime() {
  if (typeof globalWithWorker.postMessage !== "function") {
    return false;
  }
  return typeof document === "undefined" && typeof globalWithWorker.close === "function" && "onmessage" in globalThis;
}
function normalizeWorkerMessageEvent(event) {
  if (event && typeof event === "object" && "data" in event) {
    return event;
  }
  return { data: event };
}
function getGlobalWorkerMessageHandler() {
  return globalThis.onmessage ?? null;
}
function setGlobalWorkerMessageHandler(handler) {
  ;
  globalThis.onmessage = handler;
}

// src/lib/tree-sitter/parser.worker.ts
var ParserWorker = class {
  bufferParsers = /* @__PURE__ */ new Map();
  filetypeParserOptions = /* @__PURE__ */ new Map();
  filetypeAliases = /* @__PURE__ */ new Map();
  filetypeParsers = /* @__PURE__ */ new Map();
  filetypeParserPromises = /* @__PURE__ */ new Map();
  reusableParsers = /* @__PURE__ */ new Map();
  reusableParserPromises = /* @__PURE__ */ new Map();
  initializePromise;
  performance;
  dataPath;
  tsDataPath;
  initialized = false;
  constructor() {
    this.performance = {
      averageParseTime: 0,
      parseTimes: [],
      averageQueryTime: 0,
      queryTimes: []
    };
  }
  async fetchQueries(sources, filetype) {
    if (!this.tsDataPath) {
      return "";
    }
    return DownloadUtils.fetchHighlightQueries(sources, this.tsDataPath, filetype);
  }
  async initialize({ dataPath }) {
    if (this.initializePromise) {
      return this.initializePromise;
    }
    this.initializePromise = (async () => {
      this.dataPath = dataPath;
      this.tsDataPath = path2.join(dataPath, "tree-sitter");
      await mkdir3(path2.join(this.tsDataPath, "languages"), { recursive: true });
      await mkdir3(path2.join(this.tsDataPath, "queries"), { recursive: true });
      let treeWasm = await resolveBundledFilePath(
        () => import("web-tree-sitter/tree-sitter.wasm", { with: { type: "wasm" } }),
        () => import.meta.resolve("web-tree-sitter/tree-sitter.wasm"),
        import.meta.url
      );
      if (isBunfsPath(treeWasm)) {
        treeWasm = normalizeBunfsPath(path2.parse(treeWasm).base);
      }
      await Parser.init({
        locateFile() {
          return treeWasm;
        }
      });
      this.initialized = true;
    })();
    return this.initializePromise;
  }
  addFiletypeParser(filetypeParser) {
    const previousAliases = this.filetypeParserOptions.get(filetypeParser.filetype)?.aliases ?? [];
    for (const alias of previousAliases) {
      if (this.filetypeAliases.get(alias) === filetypeParser.filetype) {
        this.filetypeAliases.delete(alias);
      }
    }
    const aliases = [...new Set((filetypeParser.aliases ?? []).filter((alias) => alias !== filetypeParser.filetype))];
    this.filetypeAliases.delete(filetypeParser.filetype);
    this.filetypeParserOptions.set(filetypeParser.filetype, {
      ...filetypeParser,
      aliases
    });
    for (const alias of aliases) {
      this.filetypeAliases.set(alias, filetypeParser.filetype);
    }
    this.invalidateParserCaches(filetypeParser.filetype);
  }
  resolveCanonicalFiletype(filetype) {
    if (this.filetypeParserOptions.has(filetype)) {
      return filetype;
    }
    return this.filetypeAliases.get(filetype) ?? filetype;
  }
  invalidateParserCaches(filetype) {
    this.filetypeParsers.delete(filetype);
    this.filetypeParserPromises.delete(filetype);
    const reusableParser = this.reusableParsers.get(filetype);
    if (reusableParser) {
      reusableParser.parser.delete();
      this.reusableParsers.delete(filetype);
    }
    this.reusableParserPromises.delete(filetype);
  }
  async createQueries(filetypeParser, language) {
    try {
      const highlightQueryContent = await this.fetchQueries(filetypeParser.queries.highlights, filetypeParser.filetype);
      if (!highlightQueryContent) {
        console.error("Failed to fetch highlight queries for:", filetypeParser.filetype);
        return void 0;
      }
      const highlightsQuery = new Query(language, highlightQueryContent);
      const result = {
        highlights: highlightsQuery
      };
      if (filetypeParser.queries.injections && filetypeParser.queries.injections.length > 0) {
        const injectionQueryContent = await this.fetchQueries(
          filetypeParser.queries.injections,
          filetypeParser.filetype
        );
        if (injectionQueryContent) {
          result.injections = new Query(language, injectionQueryContent);
        }
      }
      return result;
    } catch (error) {
      console.error("Error creating queries for", filetypeParser.filetype, filetypeParser.queries);
      console.error(error);
      return void 0;
    }
  }
  async loadLanguage(languageSource) {
    if (!this.initialized || !this.tsDataPath) {
      return void 0;
    }
    const result = await DownloadUtils.downloadOrLoad(languageSource, this.tsDataPath, "languages", ".wasm", true);
    if (result.error) {
      console.error(`Error loading language ${languageSource}:`, result.error);
      return void 0;
    }
    if (!result.filePath && !result.content) {
      return void 0;
    }
    const normalizedPath = result.filePath?.replaceAll("\\", "/");
    try {
      const language = await Language.load(result.content ?? normalizedPath);
      return language;
    } catch (error) {
      console.error(`Error loading language from ${normalizedPath}:`, error);
      return void 0;
    }
  }
  async resolveFiletypeParser(filetype) {
    const canonicalFiletype = this.resolveCanonicalFiletype(filetype);
    if (this.filetypeParsers.has(canonicalFiletype)) {
      return this.filetypeParsers.get(canonicalFiletype);
    }
    if (this.filetypeParserPromises.has(canonicalFiletype)) {
      return this.filetypeParserPromises.get(canonicalFiletype);
    }
    const loadingPromise = this.loadFiletypeParser(canonicalFiletype);
    this.filetypeParserPromises.set(canonicalFiletype, loadingPromise);
    try {
      const result = await loadingPromise;
      if (result) {
        this.filetypeParsers.set(canonicalFiletype, result);
      }
      return result;
    } finally {
      this.filetypeParserPromises.delete(canonicalFiletype);
    }
  }
  async loadFiletypeParser(filetype) {
    const filetypeParserOptions = this.filetypeParserOptions.get(filetype);
    if (!filetypeParserOptions) {
      return void 0;
    }
    const language = await this.loadLanguage(filetypeParserOptions.wasm);
    if (!language) {
      return void 0;
    }
    const queries = await this.createQueries(filetypeParserOptions, language);
    if (!queries) {
      console.error("Failed to create queries for:", filetype);
      return void 0;
    }
    const filetypeParser = {
      ...filetypeParserOptions,
      queries,
      language
    };
    return filetypeParser;
  }
  async preloadParser(filetype) {
    return this.resolveFiletypeParser(filetype);
  }
  async getReusableParser(filetype) {
    const canonicalFiletype = this.resolveCanonicalFiletype(filetype);
    if (this.reusableParsers.has(canonicalFiletype)) {
      return this.reusableParsers.get(canonicalFiletype);
    }
    if (this.reusableParserPromises.has(canonicalFiletype)) {
      return this.reusableParserPromises.get(canonicalFiletype);
    }
    const creationPromise = this.createReusableParser(canonicalFiletype);
    this.reusableParserPromises.set(canonicalFiletype, creationPromise);
    try {
      const result = await creationPromise;
      if (result) {
        this.reusableParsers.set(canonicalFiletype, result);
      }
      return result;
    } finally {
      this.reusableParserPromises.delete(canonicalFiletype);
    }
  }
  async createReusableParser(filetype) {
    const filetypeParser = await this.resolveFiletypeParser(filetype);
    if (!filetypeParser) {
      return void 0;
    }
    const parser = new Parser();
    parser.setLanguage(filetypeParser.language);
    const reusableState = {
      parser,
      filetypeParser,
      queries: filetypeParser.queries
    };
    return reusableState;
  }
  async handleInitializeParser(bufferId, version, content, filetype, messageId) {
    const filetypeParser = await this.resolveFiletypeParser(filetype);
    if (!filetypeParser) {
      postWorkerMessage({
        type: "PARSER_INIT_RESPONSE",
        bufferId,
        messageId,
        hasParser: false,
        warning: `No parser available for filetype ${filetype}`
      });
      return;
    }
    const parser = new Parser();
    parser.setLanguage(filetypeParser.language);
    const tree = parser.parse(content);
    if (!tree) {
      postWorkerMessage({
        type: "PARSER_INIT_RESPONSE",
        bufferId,
        messageId,
        hasParser: false,
        error: "Failed to parse buffer"
      });
      return;
    }
    const parserState = {
      parser,
      tree,
      queries: filetypeParser.queries,
      filetype,
      content,
      injectionMapping: filetypeParser.injectionMapping
    };
    this.bufferParsers.set(bufferId, parserState);
    postWorkerMessage({
      type: "PARSER_INIT_RESPONSE",
      bufferId,
      messageId,
      hasParser: true
    });
    const highlights = await this.initialQuery(parserState);
    postWorkerMessage({
      type: "HIGHLIGHT_RESPONSE",
      bufferId,
      version,
      ...highlights
    });
  }
  async initialQuery(parserState) {
    const query = parserState.queries.highlights;
    const matches = query.captures(parserState.tree.rootNode);
    let injectionRanges = /* @__PURE__ */ new Map();
    if (parserState.queries.injections) {
      const injectionResult = await this.processInjections(parserState);
      matches.push(...injectionResult.captures);
      injectionRanges = injectionResult.injectionRanges;
    }
    return this.getHighlights(parserState, matches, injectionRanges);
  }
  getNodeText(node, content) {
    return content.substring(node.startIndex, node.endIndex);
  }
  async processInjections(parserState) {
    const injectionMatches = [];
    const injectionRanges = /* @__PURE__ */ new Map();
    if (!parserState.queries.injections) {
      return { captures: injectionMatches, injectionRanges };
    }
    const content = parserState.content;
    const injectionCaptures = parserState.queries.injections.captures(parserState.tree.rootNode);
    const languageGroups = /* @__PURE__ */ new Map();
    const injectionMapping = parserState.injectionMapping;
    for (const capture of injectionCaptures) {
      const captureName = capture.name;
      if (captureName === "injection.content" || captureName.includes("injection")) {
        const nodeType = capture.node.type;
        let targetLanguage;
        if (injectionMapping?.nodeTypes && injectionMapping.nodeTypes[nodeType]) {
          targetLanguage = injectionMapping.nodeTypes[nodeType];
        } else if (nodeType === "code_fence_content") {
          const parent = capture.node.parent;
          if (parent) {
            const infoString = parent.children.find((child) => child.type === "info_string");
            if (infoString) {
              const languageNode = infoString.children.find((child) => child.type === "language");
              if (languageNode) {
                const languageName = this.getNodeText(languageNode, content);
                if (injectionMapping?.infoStringMap && injectionMapping.infoStringMap[languageName]) {
                  targetLanguage = injectionMapping.infoStringMap[languageName];
                } else {
                  targetLanguage = languageName;
                }
              }
            }
          }
        }
        if (targetLanguage) {
          if (!languageGroups.has(targetLanguage)) {
            languageGroups.set(targetLanguage, []);
          }
          languageGroups.get(targetLanguage).push({ node: capture.node, name: capture.name });
        }
      }
    }
    for (const [language, captures] of languageGroups.entries()) {
      const injectedParser = await this.getReusableParser(language);
      if (!injectedParser) {
        console.warn(`No parser found for injection language: ${language}`);
        continue;
      }
      if (!injectionRanges.has(language)) {
        injectionRanges.set(language, []);
      }
      const parser = injectedParser.parser;
      for (const { node: injectionNode } of captures) {
        try {
          injectionRanges.get(language).push({
            start: injectionNode.startIndex,
            end: injectionNode.endIndex
          });
          const injectionContent = this.getNodeText(injectionNode, content);
          const tree = parser.parse(injectionContent);
          if (tree) {
            const matches = injectedParser.queries.highlights.captures(tree.rootNode);
            for (const match of matches) {
              const offsetCapture = {
                name: match.name,
                patternIndex: match.patternIndex,
                _injectedQuery: injectedParser.queries.highlights,
                // Store the correct query reference
                node: {
                  ...match.node,
                  startPosition: {
                    row: match.node.startPosition.row + injectionNode.startPosition.row,
                    column: match.node.startPosition.row === 0 ? match.node.startPosition.column + injectionNode.startPosition.column : match.node.startPosition.column
                  },
                  endPosition: {
                    row: match.node.endPosition.row + injectionNode.startPosition.row,
                    column: match.node.endPosition.row === 0 ? match.node.endPosition.column + injectionNode.startPosition.column : match.node.endPosition.column
                  },
                  startIndex: match.node.startIndex + injectionNode.startIndex,
                  endIndex: match.node.endIndex + injectionNode.startIndex
                }
                // Cast to any since we're creating a pseudo-node
              };
              injectionMatches.push(offsetCapture);
            }
            tree.delete();
          }
        } catch (error) {
          console.error(`Error processing injection for language ${language}:`, error);
        }
      }
    }
    return { captures: injectionMatches, injectionRanges };
  }
  editToRange(edit) {
    return {
      startPosition: {
        column: edit.startPosition.column,
        row: edit.startPosition.row
      },
      endPosition: {
        column: edit.newEndPosition.column,
        row: edit.newEndPosition.row
      },
      startIndex: edit.startIndex,
      endIndex: edit.newEndIndex
    };
  }
  async handleEdits(bufferId, content, edits) {
    const parserState = this.bufferParsers.get(bufferId);
    if (!parserState) {
      return { warning: "No parser state found for buffer" };
    }
    parserState.content = content;
    for (const edit of edits) {
      parserState.tree.edit(edit);
    }
    const startParse = performance.now();
    const newTree = parserState.parser.parse(content, parserState.tree);
    const endParse = performance.now();
    const parseTime = endParse - startParse;
    this.performance.parseTimes.push(parseTime);
    if (this.performance.parseTimes.length > 10) {
      this.performance.parseTimes.shift();
    }
    this.performance.averageParseTime = this.performance.parseTimes.reduce((acc, time) => acc + time, 0) / this.performance.parseTimes.length;
    if (!newTree) {
      return { error: "Failed to parse buffer" };
    }
    const changedRanges = parserState.tree.getChangedRanges(newTree);
    parserState.tree = newTree;
    const startQuery = performance.now();
    const matches = [];
    if (changedRanges.length === 0) {
      edits.forEach((edit) => {
        const range = this.editToRange(edit);
        changedRanges.push(range);
      });
    }
    for (const range of changedRanges) {
      let node = parserState.tree.rootNode.descendantForPosition(range.startPosition, range.endPosition);
      if (!node) {
        continue;
      }
      if (node.equals(parserState.tree.rootNode)) {
        const rangeCaptures = parserState.queries.highlights.captures(
          node,
          // WTF!?
          {
            startIndex: range.startIndex - 100,
            endIndex: range.endIndex + 1e3
          }
        );
        matches.push(...rangeCaptures);
        continue;
      }
      while (node && !this.nodeContainsRange(node, range)) {
        node = node.parent;
      }
      if (!node) {
        node = parserState.tree.rootNode;
      }
      const nodeCaptures = parserState.queries.highlights.captures(node);
      matches.push(...nodeCaptures);
    }
    let injectionRanges = /* @__PURE__ */ new Map();
    if (parserState.queries.injections) {
      const injectionResult = await this.processInjections(parserState);
      matches.push(...injectionResult.captures);
      injectionRanges = injectionResult.injectionRanges;
    }
    const endQuery = performance.now();
    const queryTime = endQuery - startQuery;
    this.performance.queryTimes.push(queryTime);
    if (this.performance.queryTimes.length > 10) {
      this.performance.queryTimes.shift();
    }
    this.performance.averageQueryTime = this.performance.queryTimes.reduce((acc, time) => acc + time, 0) / this.performance.queryTimes.length;
    return this.getHighlights(parserState, matches, injectionRanges);
  }
  nodeContainsRange(node, range) {
    return node.startPosition.row <= range.startPosition.row && node.endPosition.row >= range.endPosition.row && (node.startPosition.row < range.startPosition.row || node.startPosition.column <= range.startPosition.column) && (node.endPosition.row > range.endPosition.row || node.endPosition.column >= range.endPosition.column);
  }
  getHighlights(parserState, matches, injectionRanges) {
    const lineHighlights = /* @__PURE__ */ new Map();
    const droppedHighlights = /* @__PURE__ */ new Map();
    for (const match of matches) {
      const node = match.node;
      const startLine = node.startPosition.row;
      const endLine = node.endPosition.row;
      const highlight = {
        startCol: node.startPosition.column,
        endCol: node.endPosition.column,
        group: match.name
      };
      if (!lineHighlights.has(startLine)) {
        lineHighlights.set(startLine, /* @__PURE__ */ new Map());
        droppedHighlights.set(startLine, /* @__PURE__ */ new Map());
      }
      if (lineHighlights.get(startLine)?.has(node.id)) {
        droppedHighlights.get(startLine)?.set(node.id, lineHighlights.get(startLine)?.get(node.id));
      }
      lineHighlights.get(startLine)?.set(node.id, highlight);
      if (startLine !== endLine) {
        for (let line = startLine + 1; line <= endLine; line++) {
          if (!lineHighlights.has(line)) {
            lineHighlights.set(line, /* @__PURE__ */ new Map());
          }
          const hl = {
            startCol: 0,
            endCol: node.endPosition.column,
            group: match.name
          };
          lineHighlights.get(line)?.set(node.id, hl);
        }
      }
    }
    return {
      highlights: Array.from(lineHighlights.entries()).map(([line, lineHighlights2]) => ({
        line,
        highlights: Array.from(lineHighlights2.values()),
        droppedHighlights: droppedHighlights.get(line) ? Array.from(droppedHighlights.get(line).values()) : []
      }))
    };
  }
  getSimpleHighlights(matches, injectionRanges) {
    const highlights = [];
    const flatInjectionRanges = [];
    for (const [lang, ranges] of injectionRanges.entries()) {
      for (const range of ranges) {
        flatInjectionRanges.push({ ...range, lang });
      }
    }
    for (const match of matches) {
      const node = match.node;
      let isInjection = false;
      let injectionLang;
      let containsInjection = false;
      for (const injRange of flatInjectionRanges) {
        if (node.startIndex >= injRange.start && node.endIndex <= injRange.end) {
          isInjection = true;
          injectionLang = injRange.lang;
          break;
        } else if (node.startIndex <= injRange.start && node.endIndex >= injRange.end) {
          containsInjection = true;
          break;
        }
      }
      const matchQuery = match._injectedQuery;
      const patternProperties = matchQuery?.setProperties?.[match.patternIndex];
      const concealValue = patternProperties?.conceal ?? match.setProperties?.conceal;
      const concealLines = patternProperties?.conceal_lines ?? match.setProperties?.conceal_lines;
      const meta = {};
      if (isInjection && injectionLang) {
        meta.isInjection = true;
        meta.injectionLang = injectionLang;
      }
      if (containsInjection) {
        meta.containsInjection = true;
      }
      if (concealValue !== void 0) {
        meta.conceal = concealValue;
      }
      if (concealLines !== void 0) {
        meta.concealLines = concealLines;
      }
      if (Object.keys(meta).length > 0) {
        highlights.push([node.startIndex, node.endIndex, match.name, meta]);
      } else {
        highlights.push([node.startIndex, node.endIndex, match.name]);
      }
    }
    highlights.sort((a, b) => a[0] - b[0]);
    return highlights;
  }
  async handleResetBuffer(bufferId, version, content) {
    const parserState = this.bufferParsers.get(bufferId);
    if (!parserState) {
      return { warning: "No parser state found for buffer" };
    }
    parserState.content = content;
    const newTree = parserState.parser.parse(content);
    if (!newTree) {
      return { error: "Failed to parse buffer during reset" };
    }
    parserState.tree = newTree;
    const matches = parserState.queries.highlights.captures(parserState.tree.rootNode);
    let injectionRanges = /* @__PURE__ */ new Map();
    if (parserState.queries.injections) {
      const injectionResult = await this.processInjections(parserState);
      matches.push(...injectionResult.captures);
      injectionRanges = injectionResult.injectionRanges;
    }
    return this.getHighlights(parserState, matches, injectionRanges);
  }
  disposeBuffer(bufferId) {
    const parserState = this.bufferParsers.get(bufferId);
    if (!parserState) {
      return;
    }
    parserState.tree.delete();
    parserState.parser.delete();
    this.bufferParsers.delete(bufferId);
  }
  async handleOneShotHighlight(content, filetype, messageId) {
    const reusableState = await this.getReusableParser(filetype);
    if (!reusableState) {
      postWorkerMessage({
        type: "ONESHOT_HIGHLIGHT_RESPONSE",
        messageId,
        hasParser: false,
        warning: `No parser available for filetype ${filetype}`
      });
      return;
    }
    const parseContent = filetype === "markdown" && content.endsWith("```") ? content + "\n" : content;
    const tree = reusableState.parser.parse(parseContent);
    if (!tree) {
      postWorkerMessage({
        type: "ONESHOT_HIGHLIGHT_RESPONSE",
        messageId,
        hasParser: false,
        error: "Failed to parse content"
      });
      return;
    }
    try {
      const matches = reusableState.filetypeParser.queries.highlights.captures(tree.rootNode);
      let injectionRanges = /* @__PURE__ */ new Map();
      if (reusableState.filetypeParser.queries.injections) {
        const parserState = {
          parser: reusableState.parser,
          tree,
          queries: reusableState.filetypeParser.queries,
          filetype,
          content,
          injectionMapping: reusableState.filetypeParser.injectionMapping
        };
        const injectionResult = await this.processInjections(parserState);
        matches.push(...injectionResult.captures);
        injectionRanges = injectionResult.injectionRanges;
      }
      const highlights = this.getSimpleHighlights(matches, injectionRanges);
      postWorkerMessage({
        type: "ONESHOT_HIGHLIGHT_RESPONSE",
        messageId,
        hasParser: true,
        highlights
      });
    } finally {
      tree.delete();
    }
  }
  async updateDataPath(dataPath) {
    this.dataPath = dataPath;
    this.tsDataPath = path2.join(dataPath, "tree-sitter");
    try {
      await mkdir3(path2.join(this.tsDataPath, "languages"), { recursive: true });
      await mkdir3(path2.join(this.tsDataPath, "queries"), { recursive: true });
    } catch (error) {
      throw new Error(`Failed to update data path: ${error}`);
    }
  }
  async clearCache() {
    if (!this.dataPath || !this.tsDataPath) {
      throw new Error("No data path configured");
    }
    const { rm: rm2 } = await import("fs/promises");
    try {
      const treeSitterPath = path2.join(this.dataPath, "tree-sitter");
      await rm2(treeSitterPath, { recursive: true, force: true });
      await mkdir3(path2.join(treeSitterPath, "languages"), { recursive: true });
      await mkdir3(path2.join(treeSitterPath, "queries"), { recursive: true });
      this.filetypeParsers.clear();
      this.filetypeParserPromises.clear();
      this.reusableParsers.clear();
      this.reusableParserPromises.clear();
    } catch (error) {
      throw new Error(`Failed to clear cache: ${error}`);
    }
  }
};
function logMessage(type, ...args) {
  postWorkerMessage({
    type: "WORKER_LOG",
    logType: type,
    data: args
  });
}
function postWorkerError(bufferId, error) {
  postWorkerMessage({
    type: "ERROR",
    bufferId,
    error: error instanceof Error ? error.stack || error.message : String(error)
  });
}
if (isWorkerRuntime) {
  const worker = new ParserWorker();
  console.log = (...args) => logMessage("log", ...args);
  console.error = (...args) => logMessage("error", ...args);
  console.warn = (...args) => logMessage("warn", ...args);
  setWorkerMessageHandler(async (event) => {
    const message = event.data;
    const messageType = String(event.data.type ?? "unknown");
    try {
      switch (message.type) {
        case "INIT":
          try {
            await worker.initialize({ dataPath: message.dataPath });
            postWorkerMessage({ type: "INIT_RESPONSE" });
          } catch (error) {
            postWorkerMessage({
              type: "INIT_RESPONSE",
              error: error instanceof Error ? error.stack || error.message : String(error)
            });
          }
          break;
        case "ADD_FILETYPE_PARSER":
          worker.addFiletypeParser(message.filetypeParser);
          break;
        case "PRELOAD_PARSER": {
          const maybeParser = await worker.preloadParser(message.filetype);
          postWorkerMessage({
            type: "PRELOAD_PARSER_RESPONSE",
            messageId: message.messageId,
            hasParser: !!maybeParser
          });
          break;
        }
        case "INITIALIZE_PARSER":
          await worker.handleInitializeParser(
            message.bufferId,
            message.version,
            message.content,
            message.filetype,
            message.messageId
          );
          break;
        case "HANDLE_EDITS": {
          const response = await worker.handleEdits(message.bufferId, message.content, message.edits);
          if (response.highlights) {
            postWorkerMessage({
              type: "HIGHLIGHT_RESPONSE",
              bufferId: message.bufferId,
              version: message.version,
              highlights: response.highlights
            });
          } else if (response.warning) {
            postWorkerMessage({
              type: "WARNING",
              bufferId: message.bufferId,
              warning: response.warning
            });
          } else if (response.error) {
            postWorkerMessage({
              type: "ERROR",
              bufferId: message.bufferId,
              error: response.error
            });
          }
          break;
        }
        case "GET_PERFORMANCE":
          postWorkerMessage({
            type: "PERFORMANCE_RESPONSE",
            performance: worker.performance,
            messageId: message.messageId
          });
          break;
        case "RESET_BUFFER": {
          const resetResponse = await worker.handleResetBuffer(message.bufferId, message.version, message.content);
          if (resetResponse.highlights) {
            postWorkerMessage({
              type: "HIGHLIGHT_RESPONSE",
              bufferId: message.bufferId,
              version: message.version,
              highlights: resetResponse.highlights
            });
          } else if (resetResponse.warning) {
            postWorkerMessage({
              type: "WARNING",
              bufferId: message.bufferId,
              warning: resetResponse.warning
            });
          } else if (resetResponse.error) {
            postWorkerMessage({
              type: "ERROR",
              bufferId: message.bufferId,
              error: resetResponse.error
            });
          }
          break;
        }
        case "DISPOSE_BUFFER":
          worker.disposeBuffer(message.bufferId);
          postWorkerMessage({
            type: "BUFFER_DISPOSED",
            bufferId: message.bufferId
          });
          break;
        case "ONESHOT_HIGHLIGHT":
          await worker.handleOneShotHighlight(message.content, message.filetype, message.messageId);
          break;
        case "UPDATE_DATA_PATH":
          try {
            await worker.updateDataPath(message.dataPath);
            postWorkerMessage({
              type: "UPDATE_DATA_PATH_RESPONSE",
              messageId: message.messageId
            });
          } catch (error) {
            postWorkerMessage({
              type: "UPDATE_DATA_PATH_RESPONSE",
              messageId: message.messageId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          break;
        case "CLEAR_CACHE":
          try {
            await worker.clearCache();
            postWorkerMessage({
              type: "CLEAR_CACHE_RESPONSE",
              messageId: message.messageId
            });
          } catch (error) {
            postWorkerMessage({
              type: "CLEAR_CACHE_RESPONSE",
              messageId: message.messageId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
          break;
        default:
          postWorkerMessage({
            type: "ERROR",
            error: `Unknown message type: ${messageType}`
          });
      }
    } catch (error) {
      if ("bufferId" in message) {
        postWorkerError(message.bufferId, error);
      } else {
        postWorkerError(void 0, error);
      }
    }
  });
}
