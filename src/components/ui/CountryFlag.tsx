import type { ComponentProps } from "react";
import * as Flags from "country-flag-icons/react/3x2";
import { countryName, hasCountryFlag } from "@/lib/countries";

export type CountryFlagSize = "xs" | "sm" | "md";

export interface CountryFlagProps extends ComponentProps<"span"> {
  /** ISO 3166-1 alpha-2 country code (e.g. "DE", "US", "IR"). Case-insensitive. */
  code: string | null | undefined;
  /** Size variant. Defaults to "sm" (16x11px). */
  size?: CountryFlagSize;
  /** Custom title for tooltip. Defaults to "CountryName (CODE)". */
  title?: string;
  /** How to handle unknown or missing country codes. Defaults to "placeholder". */
  fallback?: "placeholder" | "text" | "none";
}

const SIZE_STYLES: Record<CountryFlagSize, string> = {
  xs: "w-[14px] h-[9.5px]",
  sm: "w-[16px] h-[11px]",
  md: "w-[21px] h-[14px]",
};

export function CountryFlag({
  code,
  size = "sm",
  title: customTitle,
  fallback = "placeholder",
  className = "",
  ...rest
}: CountryFlagProps) {
  if (!code) {
    if (fallback === "none") return null;
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-[2px] border border-white/10 bg-raised/50 ${SIZE_STYLES[size]} ${className}`}
        aria-hidden="true"
        {...rest}
      />
    );
  }

  const upper = code.trim().toUpperCase();
  const flagKey = upper.replace(/-/g, "_");
  const FlagSvg = (Flags as Record<string, React.ComponentType<{ className?: string }>>)[flagKey];

  const name = countryName(upper);
  const title = customTitle ?? (name ? `${name} (${upper})` : upper);

  if (!FlagSvg || !hasCountryFlag(upper)) {
    if (fallback === "none") return null;
    if (fallback === "text") {
      return (
        <span
          className={`mono inline-flex shrink-0 items-center justify-center rounded-[2px] border border-white/15 bg-raised px-1 text-[9px] font-medium text-t2 ${className}`}
          title={title}
          aria-label={title}
          {...rest}
        >
          {upper.slice(0, 3)}
        </span>
      );
    }
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-[2px] border border-white/10 bg-raised/50 ${SIZE_STYLES[size]} ${className}`}
        title={title}
        aria-label={title}
        {...rest}
      />
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[2px] border border-white/15 bg-card/60 shadow-[0_1px_2px_rgba(0,0,0,0.25)] ${SIZE_STYLES[size]} ${className}`}
      title={title}
      aria-label={title}
      role="img"
      {...rest}
    >
      <FlagSvg className="block h-full w-full object-cover" />
    </span>
  );
}
