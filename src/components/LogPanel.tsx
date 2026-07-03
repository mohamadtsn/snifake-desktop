import { useEffect, useRef } from "react";

export function LogPanel({ lines }: { lines: string[] }) {
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = viewRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="flex min-h-[160px] flex-1 flex-col gap-1.5">
      <div className="text-xs font-semibold tracking-wide text-text-dim uppercase">
        Activity Log
      </div>
      <div
        ref={viewRef}
        className="glass-panel min-h-[140px] flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-text-dim"
      >
        {lines.length === 0 ? (
          <div className="text-text-dim/50 italic">No activity yet.</div>
        ) : (
          lines.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  );
}