import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { LOCALIZED_ENTRY_POINTS, untranslatedVisibleCopy } from "./tui-localization-source"
import { validateCatalogs } from "../src/cli/tui/i18n/validate"
import { dictionaries } from "../src/cli/tui/i18n"
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const errors = [
  ...validateCatalogs(),
  ...LOCALIZED_ENTRY_POINTS.flatMap((file) =>
    untranslatedVisibleCopy(file, fs.readFileSync(path.join(packageRoot, file), "utf8")),
  ),
]
if (errors.length) {
  console.error(errors.join("\n"))
  process.exitCode = 1
} else {
  console.log(
    `Validated ${Object.keys(dictionaries).length} TUI locales and ${Object.keys(dictionaries.en).length} message keys.`,
  )
}
