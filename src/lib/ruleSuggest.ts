/**
 * What the rule editor can offer while a line is being typed. Pure, so the
 * behaviour is tested without a textarea. The vocabulary is `rules.ts`'s;
 * the `PREFIX_HELP` test pins them together. Order matters: it is the
 * order suggestions appear in.
 */
export const PREFIX_HELP = [
  { prefix: "domain", example: "domain:example.com", detail: "Exactly this name" },
  { prefix: "suffix", example: "suffix:example.com", detail: "This name and every subdomain (default for a bare name)" },
  { prefix: "keyword", example: "keyword:google", detail: "Any name containing the word" },
  { prefix: "regex", example: "regex:^ads\\.", detail: "A regular expression on the name" },
  { prefix: "ip", example: "ip:10.0.0.0/8", detail: "An IPv4 address or range (default for a bare address)" },
  { prefix: "port", example: "port:8080", detail: "A destination port (default for a bare number)" },
  { prefix: "process", example: "process:Telegram", detail: "A program by name" },
  { prefix: "path", example: "path:/usr/bin/curl", detail: "A program by full path" },
  { prefix: "ruleset", example: "ruleset:geoip-ir", detail: "A rule set under Rule sets, or any SagerNet geosite-/geoip- tag" },
  { prefix: "network", example: "network:udp", detail: "tcp or udp" },
];

export interface Suggestion {
  /** Replaces the line from its start to the caret. */
  insert: string;
  label: string;
  detail: string;
}

export function suggest(before: string, tags: string[]): Suggestion[] {
  const text = before.trimStart();
  if (text === "") return [];
  const colon = text.indexOf(":");
  if (colon < 0) {
    if (!/^[a-z]+$/i.test(text)) return [];
    const typed = text.toLowerCase();
    return PREFIX_HELP.filter((p) => p.prefix.startsWith(typed)).map((p) => ({
      insert: `${p.prefix}:`,
      label: `${p.prefix}:`,
      detail: p.detail,
    }));
  }
  const head = text.slice(0, colon);
  const partial = text.slice(colon + 1).trimStart();
  const values = head === "ruleset" ? tags : head === "network" ? ["tcp", "udp"] : [];
  return values
    .filter((v) => v.startsWith(partial) && v !== partial)
    .map((v) => ({ insert: `${head}:${v}`, label: v, detail: head === "ruleset" ? "rule set" : "network" }));
}

export function applySuggestion(text: string, caret: number, insert: string): { text: string; caret: number } {
  const start = text.lastIndexOf("\n", caret - 1) + 1;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}
