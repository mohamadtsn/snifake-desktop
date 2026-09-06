import { useState } from "react";
import { Select } from "@base-ui/react/select";
import { RuleList } from "@/components/RuleList";
import { Disclosure } from "@/components/Disclosure";
import type { Routing, TunnelMode, TunnelStore } from "@/types";

const MODES: { value: TunnelMode; label: string; capture: string; guarantee: string }[] = [
  {
    value: "manual",
    label: "Manual",
    capture: "Only applications you point at the port below.",
    guarantee: "Not applicable. Nothing is captured that you did not aim.",
  },
  {
    value: "system_proxy",
    label: "System proxy",
    capture: "Applications that read the OS proxy setting.",
    guarantee: "None. An application that ignores the setting goes direct.",
  },
  {
    value: "tun",
    label: "TUN",
    capture: "All system traffic.",
    guarantee: "Full. A firewall kill switch, failing closed.",
  },
];

/** Matches the input styling in `Field`, which is the only input style here. */
const INPUT = [
  "inset text-text placeholder:text-ghost w-full px-2.5 text-left",
  "transition-[border-color,box-shadow] duration-[var(--dur-fast)]",
  "[transition-timing-function:var(--ease-out)] focus:outline-none",
].join(" ");
const OK = "hover:border-edge focus:border-live";
const BAD = "border-st-error/70 focus:border-st-error";

/**
 * Mode, port and policy on one screen, because they are read together: the
 * question "is my traffic actually going through this?" is answered by all
 * three at once.
 *
 * The guarantee line under the mode is not decoration. A system proxy
 * cannot be made to fail closed — nothing compels an application to honour
 * it — and presenting that as equivalent to TUN would be the same lie
 * DESIGN.md §4.1 already refused about the throughput bar.
 */
export function RoutingEditor({
  store,
  saving,
  onSave,
  onBack,
}: {
  store: TunnelStore;
  saving: boolean;
  onSave: (patch: {
    mode: TunnelMode;
    proxy_host: string;
    proxy_port: number;
    routing: Routing;
  }) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<TunnelMode>(store.mode);
  const [port, setPort] = useState(String(store.proxy_port));
  const [routing, setRouting] = useState<Routing>(store.routing);
  const [rawText, setRawText] = useState(
    store.routing.raw ? JSON.stringify(store.routing.raw, null, 2) : "",
  );
  const [rawError, setRawError] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(store.routing.raw !== null);

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const chosen = MODES.find((m) => m.value === mode)!;
  // TUN arrives in a later phase; showing it greyed is honest about the
  // shape of the feature, where hiding it would make the mode list change
  // under the user at upgrade time.
  const tunAvailable = false;

  function commit() {
    let raw: unknown | null = null;
    if (rawText.trim() !== "") {
      try {
        const parsed = JSON.parse(rawText);
        if (!Array.isArray(parsed)) throw new Error("Raw rules must be a JSON array.");
        raw = parsed;
      } catch (e) {
        setRawError((e as Error).message);
        // Open the section that holds the problem: refusing to save while
        // the reason is folded away is how a Save button reads as broken.
        setRawOpen(true);
        return;
      }
    }
    setRawError(null);
    onSave({
      mode,
      proxy_host: store.proxy_host,
      proxy_port: portNumber,
      routing: { ...routing, raw },
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-line flex shrink-0 items-center gap-2 border-b px-4 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="text-faint hover:text-text flex items-center gap-1.5 text-[10px] uppercase transition-colors focus-visible:outline-none"
          style={{ letterSpacing: "var(--track-engrave)" }}
        >
          &lsaquo; Back
        </button>
        <h2
          className="text-dim flex-1 text-center text-[10px] uppercase"
          style={{ letterSpacing: "var(--track-engrave)" }}
        >
          Routing
        </h2>
        <button
          type="button"
          onClick={commit}
          disabled={saving || !portValid}
          className="chip bg-live text-live-ink border-live hover:bg-live h-7 px-3 disabled:opacity-30"
        >
          Save
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-3 pb-4">
        <div className="flex flex-col gap-1.5">
          <label
            className="text-faint text-[9.5px] uppercase"
            style={{ letterSpacing: "var(--track-engrave)" }}
          >
            Mode
          </label>
          <Select.Root value={mode} onValueChange={(v) => setMode(v as TunnelMode)}>
            <Select.Trigger className="selector">
              <span className="flex-1 text-left text-[12.5px]">{chosen.label}</span>
              <Select.Icon className="text-faint shrink-0 text-[9px]">▼</Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner
                sideOffset={4}
                alignItemWithTrigger={false}
                className="z-50 outline-none"
              >
                <Select.Popup className="menu">
                  {MODES.map((m) => (
                    <Select.Item
                      key={m.value}
                      value={m.value}
                      disabled={m.value === "tun" && !tunAvailable}
                      className="menu-item"
                    >
                      <Select.ItemText className="flex-1 text-[12px]">{m.label}</Select.ItemText>
                      {m.value === "tun" && !tunAvailable && (
                        <span className="text-faint shrink-0 text-[9.5px]">soon</span>
                      )}
                    </Select.Item>
                  ))}
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
          <p className="text-faint prose-face text-[10.5px] leading-relaxed">
            Captures: {chosen.capture}
            <br />
            Leak guarantee: {chosen.guarantee}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            className="text-faint text-[9.5px] uppercase"
            style={{ letterSpacing: "var(--track-engrave)" }}
          >
            Proxy port
          </label>
          <input
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!portValid ? true : undefined}
            className={`${INPUT} h-9 text-[12px] ${portValid ? OK : BAD}`}
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
          {/* The same words ProfileEditor uses for the same rule on the same
              kind of field. Two phrasings for one constraint read as two
              different constraints. */}
          <div className="min-h-[14px]">
            {!portValid && (
              <span className="text-st-error text-[10px] leading-none">1–65535.</span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Toggle
            label="Default route through the tunnel"
            checked={routing.default_route === "proxy"}
            onChange={(v) => setRouting({ ...routing, default_route: v ? "proxy" : "direct" })}
          />
          <Toggle
            label="Block QUIC (UDP 443)"
            hint="On, because this path is a TCP relay: without it QUIC leaves the tunnel instead of falling back. Costs some speed on video sites."
            checked={routing.block_quic}
            onChange={(v) => setRouting({ ...routing, block_quic: v })}
          />
          <Toggle
            label="Allow local network"
            hint="Keeps the router, printer and anything else on your LAN reachable."
            checked={routing.allow_lan}
            onChange={(v) => setRouting({ ...routing, allow_lan: v })}
          />
        </div>

        {/* Stacked in the order the rules are evaluated, so the mental
            model and the machine agree. */}
        <RuleList
          label="Block"
          hint="Matched first. Prefixes: domain, suffix, keyword, regex, ip, port, process, path, ruleset, network. Or paste bare domains, one per line."
          value={routing.block}
          onChange={(block) => setRouting({ ...routing, block })}
        />
        <RuleList
          label="Bypass"
          hint="Goes direct, around the tunnel."
          value={routing.bypass}
          onChange={(bypass) => setRouting({ ...routing, bypass })}
        />
        <RuleList
          label="Proxy"
          hint="Forced through the tunnel, whatever the default route is."
          value={routing.proxy}
          onChange={(proxy) => setRouting({ ...routing, proxy })}
        />

        <Disclosure label="Raw rules" open={rawOpen} onOpenChange={setRawOpen}>
          <textarea
            dir="ltr"
            spellCheck={false}
            autoComplete="off"
            rows={6}
            aria-invalid={rawError ? true : undefined}
            className={`${INPUT} min-h-[110px] resize-y py-2 text-[12px] leading-relaxed ${
              rawError ? BAD : OK
            }`}
            placeholder='[ { "domain": ["example.com"], "outbound": "direct" } ]'
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
          />
          <p className="text-faint prose-face mt-1.5 text-[10.5px] leading-relaxed">
            Merged into the core&rsquo;s rules verbatim, after the built-in guards and before
            the three lists. The guards cannot be overridden: they are what stop the tunnel
            swallowing the SNI stage&rsquo;s own connection.
          </p>
          <div className="min-h-[14px]">
            {rawError && <span className="text-st-error text-[10px] leading-none">{rawError}</span>}
          </div>
        </Disclosure>
      </div>
    </div>
  );
}

/** Local to this screen. If a second one appears elsewhere, promote it. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      {/* The same checkbox as Activity's per-packet switch. A native box
          with an accent colour, not a bespoke one: two shapes for one
          control would be two vocabularies. */}
      <input
        type="checkbox"
        className="mt-0.5 size-3 shrink-0 rounded-[2px] accent-[var(--color-live)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="text-text block text-[12px] leading-none">{label}</span>
        {hint && (
          <span className="text-faint prose-face mt-1.5 block text-[10.5px] leading-relaxed">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
