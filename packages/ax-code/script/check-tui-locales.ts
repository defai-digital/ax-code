import { validateCatalogs } from "../src/cli/cmd/tui/i18n/validate"
import { dictionaries } from "../src/cli/cmd/tui/i18n"
const errors = validateCatalogs()
if (errors.length) {
  console.error(errors.join("\n"))
  process.exitCode = 1
} else {
  console.log(
    `Validated ${Object.keys(dictionaries).length} TUI locales and ${Object.keys(dictionaries.en).length} message keys.`,
  )
}
