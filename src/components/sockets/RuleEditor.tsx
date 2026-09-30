import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { StatusDot } from "@/components/ui/StatusDot";
import { checkRuleList } from "@/lib/rules";

export type ListName = "block" | "bypass" | "proxy";

/**
 * The three rule lists, one at a time, with every line checked as it is
 * typed.
 *
 * Validation runs against `src/lib/rules.ts`, which duplicates
 * `tunnel/rules.rs` on purpose: a round trip to Rust per keystroke would be
 * slow and, under WebKitGTK, visibly jittery. Rust stays the authority and
 * re-validates on save, so a drift between the two surfaces as a rejected
 * save rather than as a bad config reaching the core.
 *
 * The highlight sits in a layer *behind* a transparent textarea rather than
 * inside a contenteditable. It costs one mirrored div and exact font
 * metrics; a contenteditable would cost the caret, undo, and every IME.
 */
export function RuleEditor({
  list,
  onListChange,
  lines,
  onLinesChange,
  counts,
  invalid,
  ruleSetTags,
}: {
  list: ListName;
  onListChange: (list: ListName) => void;
  /** The current list's text, one rule per line. */
  lines: string;
  onLinesChange: (text: string) => void;
  counts: Record<ListName, number>;
  /** Which lists have a line that does not parse, so the tab says so. */
  invalid: Record<ListName, boolean>;
  /** Tags the user defined under Rule sets; a `ruleset:` line must name
   *  one of them or a SagerNet `geosite-`/`geoip-` tag. */
  ruleSetTags: string[];
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const rows = useMemo(() => lines.split("\n"), [lines]);
  const errors = useMemo(() => checkRuleList(rows, ruleSetTags), [rows, ruleSetTags]);
  const firstBad = errors.findIndex((e) => e !== null);
  const active = rows.filter((l) => l.trim() !== "" && !l.trim().startsWith("#")).length;

  /** Put the caret on the first bad line, so "fix it" means one click. */
  function jump() {
    const area = areaRef.current;
    if (!area || firstBad < 0) return;
    const start = rows.slice(0, firstBad).reduce((n, l) => n + l.length + 1, 0);
    area.focus();
    area.setSelectionRange(start, start + rows[firstBad].length);
  }

  function prune() {
    const seen = new Set<string>();
    const kept = rows.filter((line) => {
      const key = line.trim();
      if (key === "") return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    onLinesChange(kept.join("\n"));
  }

  async function pasteBatch() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      onLinesChange(lines.trim() === "" ? text.trim() : `${lines.replace(/\n+$/, "")}\n${text.trim()}`);
    } catch {
      // No clipboard permission under this webview. The textarea still takes
      // an ordinary paste, which is the fallback.
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-[2px]">
        <h2 className="text-note font-semibold tracking-[0.55px] text-t2 uppercase">
          Dynamic rule sets
        </h2>
        <span className="flex items-center gap-[5px] text-note text-t3">
          <Icon name="rule" size={13} />
          Checked as you type
        </span>
      </div>

      <Segmented
        stretch
        label="Rule list"
        value={list}
        onChange={onListChange}
        options={[
          { value: "block", label: "Block", badge: counts.block, badgeTone: invalid.block ? "bad" : undefined },
          { value: "bypass", label: "Bypass", badge: counts.bypass, badgeTone: invalid.bypass ? "bad" : undefined },
          { value: "proxy", label: "Proxy", badge: counts.proxy, badgeTone: invalid.proxy ? "bad" : undefined },
        ]}
      />

      <div className="mt-2 overflow-hidden rounded-lg border border-hairline bg-card shadow-specular">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-[7px]">
          <span className="mono truncate text-note text-t3">
            routing_table: {list} · {active} active {active === 1 ? "entry" : "entries"}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => void pasteBatch()}>
              <Icon name="content_paste" size={13} />
              Paste batch
            </Button>
            <Button size="sm" variant="ghost" onClick={prune}>
              <Icon name="cleaning_services" size={13} />
              Prune
            </Button>
          </span>
        </div>

        <div className="relative flex bg-inset">
          {/* The gutter scrolls with the text rather than with the page: it
              is part of the same document, and a number that drifts from its
              line is worse than no number. */}
          <div
            aria-hidden
            className="mono w-[42px] shrink-0 overflow-hidden border-r border-hairline py-[10px] text-right text-note leading-[18px]"
          >
            <div style={{ transform: `translateY(${-scrollTop}px)` }}>
              {rows.map((_, i) => (
                <div key={i} className={`pr-2 ${errors[i] ? "text-bad" : "text-t4"}`}>
                  {i + 1}
                </div>
              ))}
            </div>
          </div>

          <div className="relative min-w-0 flex-1">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden py-[10px]"
            >
              <div style={{ transform: `translateY(${-scrollTop}px)` }}>
                {rows.map((_, i) => (
                  <div
                    key={i}
                    className={`mono flex h-[18px] items-center justify-end px-3 text-note leading-[18px] ${
                      errors[i] ? "bg-bad-soft" : ""
                    }`}
                  >
                    {errors[i] ? (
                      /* Capped and truncated: the reason is an annotation on
                         the line, not a replacement for it, and a long
                         message must never cover the rule being fixed. The
                         tray below carries the full sentence. */
                      <span className="max-w-[45%] truncate rounded-xs bg-bad-soft px-[5px] text-bad">
                        {errors[i]}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <textarea
              ref={areaRef}
              value={lines}
              onChange={(e) => onLinesChange(e.target.value)}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              spellCheck={false}
              // No soft wrap. The gutter and the highlight layer render one
              // fixed-height row per newline; a line that wraps to three
              // visual rows puts every number and every red wash below it
              // against the wrong rule. A rule scrolls sideways instead,
              // which is what `.log-lines` does for the same reason.
              wrap="off"
              dir="ltr"
              aria-label={`${list} rules, one per line`}
              placeholder={"domain: example.com\nsuffix: .example.org\nip: 10.0.0.0/8"}
              className="mono pick relative block h-[188px] w-full resize-none overflow-x-auto bg-transparent px-3 py-[10px] text-note leading-[18px] whitespace-pre text-t1 placeholder:text-t4 focus:outline-none"
            />
          </div>
        </div>

        <div
          className={`flex items-center justify-between gap-3 border-t px-3 py-[7px] ${
            firstBad >= 0 ? "border-bad-line bg-bad-soft" : "border-hairline"
          }`}
        >
          {firstBad >= 0 ? (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <Icon name="error" size={14} className="shrink-0 text-bad" />
                <span className="truncate text-note text-t1">
                  Line {firstBad + 1}: {errors[firstBad]}
                </span>
              </span>
              <Button size="sm" variant="danger" onClick={jump}>
                Jump and fix
              </Button>
            </>
          ) : (
            <span className="flex items-center gap-2">
              <StatusDot tone="ok" size={6} />
              <span className="text-note text-t2">
                Every line parses. Rust checks them again when you save.
              </span>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
