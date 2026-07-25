import { ProxyState, STATE_TEXT, STATE_SUBTITLE, STATE_ORB } from "@/types";

export function StatusHero({ state, sni }: { state: ProxyState; sni: string }) {
  // key={state} remounts rather than updating text in place. WebKitGTK
  // sometimes fails to repaint text whose content changes under a composited
  // layer, leaving stale glyphs — and the remount is what re-triggers the
  // orb's pop animation, so it earns its place twice.
  return (
    <div key={state} className="flex flex-col items-center gap-3.5 pt-7 pb-6">
      <div
        className="orb"
        data-state={state}
        style={{ ["--orb" as string]: STATE_ORB[state] }}
      />
      <div className="flex flex-col items-center gap-1">
        {/* Tracking is negative here and 0 on body copy: letters read too far
            apart as display type grows. */}
        <h1 className="text-[27px] leading-none font-semibold tracking-[-0.021em] text-text">
          {STATE_TEXT[state]}
        </h1>
        <p className="text-[12.5px] leading-none text-dim">{STATE_SUBTITLE[state]}</p>
      </div>
      <p className="font-mono text-[11px] tracking-[0.01em] text-faint">{sni}</p>
    </div>
  );
}
