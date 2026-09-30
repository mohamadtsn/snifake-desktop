import { countries, hasFlag } from "country-flag-icons";

export interface Country {
  code: string;
  name: string;
}

const SPECIAL_NAMES: Record<string, string> = {
  AC: "Ascension Island",
  CP: "Clipperton Island",
  DG: "Diego Garcia",
  EA: "Ceuta & Melilla",
  EU: "European Union",
  IC: "Canary Islands",
  TA: "Tristan da Cunha",
  XA: "Abkhazia",
  XC: "Northern Cyprus",
  XK: "Kosovo",
  XO: "South Ossetia",
};

const displayNames =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames !== "undefined"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

/**
 * Returns a human-friendly English name for an ISO 3166-1 alpha-2 country code.
 * Falls back to the uppercase code if unknown.
 */
export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  const upper = code.trim().toUpperCase();
  if (SPECIAL_NAMES[upper]) return SPECIAL_NAMES[upper];
  if (displayNames) {
    try {
      const name = displayNames.of(upper);
      if (name && name !== upper) return name;
    } catch {
      // Ignore unsupported or custom codes
    }
  }
  return upper;
}

/**
 * Checks whether an SVG flag is available for the given country code.
 */
export function hasCountryFlag(code: string | null | undefined): boolean {
  if (!code) return false;
  const upper = code.trim().toUpperCase();
  return hasFlag(upper);
}

/**
 * Full list of supported countries with their codes and friendly names.
 */
export const ALL_COUNTRIES: readonly Country[] = countries.map((code) => ({
  code,
  name: countryName(code),
}));
