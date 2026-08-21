import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import it from "@/locales/it.json";

/**
 * Dashboard i18n. `en` is the source catalog and the fallback for a missing key
 * and for an unknown language, so nothing ever renders a raw key.
 *
 * The catalogs are imported, not fetched: adding a language is one JSON file
 * plus one line in this registry, and no request can ask the server for a
 * catalog path any more.
 */
const SUPPORTED = ["en", "it"] as const;
export type SupportedLocale = (typeof SUPPORTED)[number];

export const supportedLocales = SUPPORTED;

const stored = (() => {
  try {
    return localStorage.getItem("isitdown.uiLocale") ?? undefined;
  } catch {
    /* a blocked localStorage only costs the remembered choice */
    return undefined;
  }
})();

void i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, it: { translation: it } },
  lng: resolve(stored),
  fallbackLng: "en",
  // "overview.title.down" is one key, not a path; a ":" inside a value is text.
  keySeparator: false,
  nsSeparator: false,
  interpolation: {
    prefix: "{",
    suffix: "}",
    // React escapes on render; escaping here would double-encode "A & B".
    escapeValue: false,
  },
  returnNull: false,
});

function resolve(lang: string | undefined): SupportedLocale {
  return SUPPORTED.includes(lang as SupportedLocale) ? (lang as SupportedLocale) : "en";
}

/** Applies language, falling back to `en`, remembers choice. */
export async function switchLocale(lang: string): Promise<SupportedLocale> {
  const next = resolve(lang);
  await i18next.changeLanguage(next);
  document.documentElement.setAttribute("lang", next);
  try {
    localStorage.setItem("isitdown.uiLocale", next);
  } catch {
    /* only the pre-paint lang hint is lost */
  }
  return next;
}

export default i18next;
