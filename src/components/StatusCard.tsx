import { ProxyState, STATE_TEXT, STATE_SUBTITLE, STATE_DOT_CLASS } from "@/types";

export function StatusCard({ state }: { state: ProxyState }) {
  // key={state} forces a full remount instead of an in-place text update —
  // WebKitGTK's compositor sometimes fails to repaint text sitting under a
  // backdrop-filter panel when only the text content changes in place,
  // leaving stale/garbled glyphs until something else forces a repaint.
  return (
    <div key={state} className="glass-panel flex items-center gap-3 p-4">
      <span
        className={`h-4 w-4 flex-shrink-0 rounded-full shadow-[0_0_10px_2px] shadow-current ${STATE_DOT_CLASS[state]}`}
      />
      <div>
        <div className="text-base font-bold text-text">{STATE_TEXT[state]}</div>
        <div className="text-[11px] text-text-dim">{STATE_SUBTITLE[state]}</div>
      </div>
    </div>
  );
}