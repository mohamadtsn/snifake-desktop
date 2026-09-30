import { isRuleSetTag } from "./rules";
import type { RuleSetDef } from "@/types";

export function formatFromName(name: string): "binary" | "source" {
  return /\.json$/i.test(name) ? "source" : "binary";
}

/** `url` is null for a file import, which Rust checks itself. */
export function ruleSetDefError(tag: string, url: string | null, existing: RuleSetDef[]): string | null {
  if (!isRuleSetTag(tag)) return `"${tag}" is not a rule set tag. Use letters, digits and . _ @ ! -`;
  if (existing.some((d) => d.tag === tag)) return `"${tag}" is already defined.`;
  if (url !== null && !/^https?:\/\/\S+$/.test(url)) return "The URL must start with http:// or https://.";
  return null;
}
