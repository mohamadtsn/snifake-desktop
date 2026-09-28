import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { StatusDot } from "@/components/ui/StatusDot";
import { parseRawRules } from "@/lib/rawRules";
import { validateRuleList } from "@/lib/rules";
import type { DraftOwner, DraftReport } from "@/lib/leaveGuard";
import type { Routing, TunnelMode, TunnelStore } from "@/types";
import { AdvancedJson } from "./AdvancedJson";
import { ModeCards } from "./ModeCards";
import { RuleEditor, type ListName } from "./RuleEditor";
import { SafeguardList } from "./SafeguardList";

/** The stored lists are arrays; the editor is a textarea. One conversion,
 *  in one place, so a trailing blank line cannot become a stored rule. */
const toText = (list: string[]) => list.join("\n");
const toList = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

export function SocketsTab({
  store,
  onSave,
  saving,
  onDraftChange,
  systemProxyBlocked,
}: {
  store: TunnelStore | null;
  /** Resolves once saved; rejects, after the shell has shown why, if not. */
  onSave: (patch: {
    mode: TunnelMode;
    proxy_host: string;
    proxy_port: number;
    routing: Routing;
  }) => Promise<void>;
  saving: boolean;
  /** Reported up so the shell can guard every exit with one decision. Must
   *  be a stable callback. */
  onDraftChange: (report: DraftReport | null, owner: DraftOwner) => void;
  /** `sysproxy_support()`: `null` when this desktop can be written to. */
  systemProxyBlocked: string | null;
}) {
  const [list, setList] = useState<ListName>("block");
  const [mode, setMode] = useState<TunnelMode>(store?.mode ?? "manual");
  const [routing, setRouting] = useState<Routing | null>(store?.routing ?? null);
  const [text, setText] = useState({ block: "", bypass: "", proxy: "" });
  const [raw, setRaw] = useState("");

  /** What the draft was loaded from, so an unrelated write to the tunnel
   *  store - Preferences saving `proxy_port`, say - does not silently throw
   *  away rules the user is in the middle of typing. */
  const loadedFrom = useRef<string | null>(null);

  // Reload the draft when the *routing* changes: on first load, and after a
  // save returns the canonical version.
  useEffect(() => {
    if (!store) return;
    const signature = JSON.stringify({ mode: store.mode, routing: store.routing });
    if (loadedFrom.current === signature) return;
    loadedFrom.current = signature;
    setMode(store.mode);
    setRouting(store.routing);
    setText({
      block: toText(store.routing.block),
      bypass: toText(store.routing.bypass),
      proxy: toText(store.routing.proxy),
    });
    setRaw(store.routing.raw === null ? "" : JSON.stringify(store.routing.raw, null, 2));
  }, [store]);

  const rawParsed = useMemo(() => parseRawRules(raw), [raw]);

  const badLines = useMemo(
    () =>
      (["block", "bypass", "proxy"] as ListName[]).filter((name) =>
        validateRuleList(text[name].split("\n")).some((e) => e !== null),
      ),
    [text],
  );

  /** The draft as it would be saved. Computed above the loading return so
   *  `dirty` can be reported from a hook, which must not sit behind a
   *  conditional return. */
  const next: Routing | null = useMemo(
    () =>
      routing && {
        ...routing,
        block: toList(text.block),
        bypass: toList(text.bypass),
        proxy: toList(text.proxy),
        raw: rawParsed.value,
      },
    [routing, text, rawParsed.value],
  );

  const dirty =
    store !== null &&
    next !== null &&
    (mode !== store.mode || JSON.stringify(next) !== JSON.stringify(store.routing));

  /** Why the draft cannot be saved as it is, in the footer's own words, or
   *  `null`. Above the loading return for the same reason as `next`. */
  const blockedReason =
    badLines.length > 0
      ? `Fix the ${badLines.join(" and ")} list before saving.`
      : rawParsed.error !== null
        ? "Fix the raw JSON before saving."
        : null;

  // Reported up so the shell can guard every exit with one decision.
  // Cleared on unmount, so a torn-down tab cannot leave the guard armed.
  useEffect(() => {
    if (!store || !next) return onDraftChange(null, "sockets");
    onDraftChange(
      {
        owner: "sockets",
        dirty,
        invalid: blockedReason,
        save: () =>
          onSave({ mode, proxy_host: store.proxy_host, proxy_port: store.proxy_port, routing: next }),
      },
      "sockets",
    );
    return () => onDraftChange(null, "sockets");
  }, [store, next, mode, dirty, blockedReason, onDraftChange, onSave]);

  if (!store || !routing || !next) {
    return (
      <div className="px-5 py-5">
        <p className="text-body text-t2">Loading the routing configuration.</p>
      </div>
    );
  }

  const counts: Record<ListName, number> = {
    block: toList(text.block).length,
    bypass: toList(text.bypass).length,
    proxy: toList(text.proxy).length,
  };

  const blocked = blockedReason !== null;

  function discard() {
    if (!store) return;
    setMode(store.mode);
    setRouting(store.routing);
    setText({
      block: toText(store.routing.block),
      bypass: toText(store.routing.bypass),
      proxy: toText(store.routing.proxy),
    });
    setRaw(store.routing.raw === null ? "" : JSON.stringify(store.routing.raw, null, 2));
  }

  return (
    <div className="flex flex-col gap-5 px-5 py-5">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-note text-t3">Sockets and traffic routing rules</p>
          <h1 className="mt-[2px] text-title font-semibold tracking-[-0.4px] text-t1">
            Traffic rules engine
          </h1>
        </div>
        <span className="mono flex shrink-0 items-center gap-2 rounded-sm border border-hairline bg-inset px-[9px] py-[4px] text-note text-t2">
          {store.proxy_host}:{store.proxy_port}
          <StatusDot tone={mode === "tun" ? "ok" : "off"} size={6} />
        </span>
      </header>

      <ModeCards
        mode={mode}
        bound={`port ${store.proxy_port}`}
        onChange={setMode}
        systemProxyBlocked={systemProxyBlocked}
      />

      <SafeguardList
        routing={routing}
        onChange={(patch) => setRouting({ ...routing, ...patch })}
      />

      <RuleEditor
        list={list}
        onListChange={setList}
        lines={text[list]}
        onLinesChange={(value) => setText({ ...text, [list]: value })}
        counts={counts}
        invalid={{
          block: badLines.includes("block"),
          bypass: badLines.includes("bypass"),
          proxy: badLines.includes("proxy"),
        }}
      />

      <AdvancedJson value={raw} onChange={setRaw} error={rawParsed.error} />

      {/* Inside the scroll region, not pinned: the mockup's frame clips it,
          and the clipped content is real content (spec 6.2). */}
      <footer className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-card px-4 py-3 shadow-specular">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot tone={blocked ? "bad" : dirty ? "warn" : "ok"} size={8} />
          <span className="truncate text-note text-t2">
            {blocked
              ? blockedReason
              : dirty
                ? "Unsaved changes."
                : "Saved. Rust re-checks every rule when it generates the config."}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <Button variant="secondary" onClick={discard} disabled={!dirty || saving}>
            Discard
          </Button>
          <Button
            variant="primary"
            disabled={!dirty || blocked || saving}
            onClick={() =>
              // The shell has already shown why a save failed.
              void onSave({
                mode,
                proxy_host: store.proxy_host,
                proxy_port: store.proxy_port,
                routing: next,
              }).catch(() => {})
            }
          >
            <Icon name="save" size={14} />
            {saving ? "Saving" : "Save rules"}
          </Button>
        </span>
      </footer>
    </div>
  );
}
