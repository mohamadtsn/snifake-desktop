import { describe, expect, it } from "vitest";
import { ALL_COUNTRIES, countryName, hasCountryFlag } from "./countries";

describe("countries", () => {
  it("resolves standard ISO country names", () => {
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("US")).toBe("United States");
    expect(countryName("IR")).toBe("Iran");
    expect(countryName("gb")).toBe("United Kingdom");
  });

  it("handles special reservation codes", () => {
    expect(countryName("EU")).toBe("European Union");
    expect(countryName("XK")).toBe("Kosovo");
  });

  it("handles null and empty input gracefully", () => {
    expect(countryName(null)).toBe("");
    expect(countryName(undefined)).toBe("");
    expect(countryName("")).toBe("");
  });

  it("checks flag availability correctly", () => {
    expect(hasCountryFlag("DE")).toBe(true);
    expect(hasCountryFlag("de")).toBe(true);
    expect(hasCountryFlag("US")).toBe(true);
    expect(hasCountryFlag("ZZZ")).toBe(false);
    expect(hasCountryFlag(null)).toBe(false);
  });

  it("exports a non-empty list of all supported countries", () => {
    expect(ALL_COUNTRIES.length).toBeGreaterThan(200);
    const de = ALL_COUNTRIES.find((c) => c.code === "DE");
    expect(de).toBeDefined();
    expect(de?.name).toBe("Germany");
  });
});
