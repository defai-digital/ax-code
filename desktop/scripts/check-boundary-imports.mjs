import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const targetFiles = [
  'packages/web/src',
  'packages/web/server',
  'packages/electron/src',
];

const disallowedPatterns = [
  /\.\.\/ui\/src\b/,
  /\.\.\/desktop\/src\b/,
];

const allowedOpenChamberUiImports = [
  /^@openchamber\/ui$/,
  /^@openchamber\/ui\/main$/,
  /^@openchamber\/ui\/index\.css$/,
  /^@openchamber\/ui\/styles\/fonts$/,
  /^@openchamber\/ui\/terminalApi$/,
  /^@openchamber\/ui\/api\/(endpoints|gitApiHttp|types)$/,
  /^@openchamber\/ui\/apps\/renderElectronMiniChatApp$/,
];

const importSpecifiers = [
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const packageDependencyRules = [
  {
    packageJsonPath: 'packages/ui/package.json',
    dependencyNames: [
      'electron',
      'electron-updater',
      'express',
      'http-proxy-middleware',
      'node-pty',
      'simple-git',
    ],
    reason: 'server or desktop-shell dependency declared by UI package',
  },
];

function collectFiles(baseDir, extensions) {
  const entries = readdirSync(baseDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      files.push(...collectFiles(fullPath, extensions));
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

function addViolation(file, lineNumber, lineText, reason) {
  violations.push({
    file,
    lineNumber,
    lineText: lineText.trim(),
    reason,
  });
}

function isAllowedOpenChamberUiImport(specifier) {
  return allowedOpenChamberUiImports.some((pattern) => pattern.test(specifier));
}

function dependencyLineNumber(content, dependencyName) {
  const lines = content.split(/\r?\n/);
  const needle = `"${dependencyName}"`;
  const index = lines.findIndex((line) => line.includes(needle));
  return index === -1 ? 1 : index + 1;
}

for (const filePath of targetFiles) {
  const absolute = path.join(ROOT, filePath);
  const files = collectFiles(absolute, ['.ts', '.tsx', '.js', '.jsx']);
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (disallowedPatterns.some((pattern) => pattern.test(line))) {
        addViolation(
          file,
          index + 1,
          line,
          'sibling-package source import',
        );
      }

      for (const pattern of importSpecifiers) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line)) !== null) {
          const specifier = match[1];
          if (
            specifier.startsWith('@openchamber/ui/') &&
            !isAllowedOpenChamberUiImport(specifier)
          ) {
            addViolation(
              file,
              index + 1,
              line,
              `private @openchamber/ui import: ${specifier}`,
            );
          }
        }
      }
    });
  }
}

for (const rule of packageDependencyRules) {
  const file = path.join(ROOT, rule.packageJsonPath);
  const content = readFileSync(file, 'utf8');
  const manifest = JSON.parse(content);
  const dependencyBlocks = [
    manifest.dependencies ?? {},
    manifest.devDependencies ?? {},
    manifest.peerDependencies ?? {},
    manifest.optionalDependencies ?? {},
  ];

  for (const dependencyName of rule.dependencyNames) {
    if (dependencyBlocks.some((block) => Object.hasOwn(block, dependencyName))) {
      addViolation(
        file,
        dependencyLineNumber(content, dependencyName),
        `"${dependencyName}"`,
        rule.reason,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('Boundary import check failed.');
  for (const item of violations) {
    const relative = path.relative(ROOT, item.file);
    console.error(`- ${relative}:${item.lineNumber}: ${item.reason}: ${item.lineText}`);
  }
  process.exit(1);
}

console.log('Boundary import check passed.');
