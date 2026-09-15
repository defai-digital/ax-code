import { sharedSpelling } from "./shared-spelling"
import { dictionaries, type Dictionary } from "./index"

export function validateCatalogs(catalogs: Record<string, Partial<Dictionary>> = dictionaries): string[] {
  const errors: string[] = []
  const source = dictionaries.en
  const placeholders = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)]
      .map((m) => m[1])
      .sort()
      .join(",")
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const [key, template] of Object.entries(source)) {
      const translated = catalog[key as keyof Dictionary]
      if (!translated?.trim()) errors.push(`${locale}: missing or empty ${key}`)
      else if (translated !== translated.normalize("NFC")) errors.push(`${locale}: non-NFC ${key}`)
      else if (placeholders(template) !== placeholders(translated))
        errors.push(`${locale}: placeholder mismatch ${key}`)
    }
    if (locale !== "en") {
      for (const [key, template] of Object.entries(source)) {
        if (catalog[key as keyof Dictionary] === template && !(sharedSpelling[locale] ?? []).includes(key))
          errors.push(`${locale}: untranslated ${key}`)
      }
    }
    for (const key of Object.keys(catalog)) if (!Object.hasOwn(source, key)) errors.push(`${locale}: unknown ${key}`)
  }
  return errors
}
