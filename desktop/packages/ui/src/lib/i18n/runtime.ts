export type Locale = 'en';

export const LOCALES = ['en'] as const satisfies readonly Locale[];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABEL_KEYS: Record<Locale, 'common.language.english'> = {
  en: 'common.language.english',
};
