import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const TARGET_ROOTS = [
  "packages/ui/src",
  "packages/web/src",
];

const ALLOWLIST = [
  /\/api\/constants\.ts$/,
  /\/lib\/http\.ts$/,
  /__tests__\//,
  /\.test\.[cm]?tsx?$/,
  /\.spec\.[cm]?tsx?$/,
];

const directFetchPathPattern = /fetch\s*\(\s*([`'"])([^`'"\n\\]*(?:\\.[^`'"\n\\]*)*)\1/;
const hasApiOrHealthLiteral = (input) =>
  input.startsWith("/api/") ||
  input === "/api" ||
  input === "/health" ||
  input.startsWith("/health?");

function collectFiles(baseDir, extensions, includeDirs = true) {
  const entries = readdirSync(baseDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      if (!includeDirs) {
        continue;
      }
      if (entry.name === "dist" || entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      files.push(...collectFiles(fullPath, extensions, includeDirs));
      continue;
    }
    if (!extensions.includes(path.extname(entry.name))) {
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

const violations = [];

for (const target of TARGET_ROOTS) {
  const absoluteTarget = path.join(ROOT, target);
  const files = collectFiles(absoluteTarget, [".ts", ".tsx", ".js", ".jsx"]);

  for (const filePath of files) {
    const relativeFilePath = path.relative(ROOT, filePath);
    if (ALLOWLIST.some((pattern) => pattern.test(relativeFilePath))) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) {
        continue;
      }

      const match = trimmed.match(directFetchPathPattern);
      if (!match) {
        continue;
      }

      const endpoint = match[2];
      if (hasApiOrHealthLiteral(endpoint)) {
        violations.push({
          file: relativeFilePath,
          line: index + 1,
          lineText: trimmed,
          endpoint,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Endpoint contract check failed: inline /api or /health fetch endpoints remain.");
  for (const item of violations) {
    console.error(`- ${item.file}:${item.line}: ${item.lineText}`);
  }
  console.error();
  console.error("Use shared constants from packages/ui/src/lib/http.ts and packages/web/src/api/constants.ts.");
  process.exit(1);
}

console.log("Endpoint contract check passed.");

