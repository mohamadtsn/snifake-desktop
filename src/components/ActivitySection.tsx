import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Disclosure } from "@/components/Disclosure";

/**
 * All log state lives here, not in App, so that closing the section unmounts
 * every log line at once. The section also tells the backend whether to bother
 * sending batches at all: while it is closed, the proxy's output accumulates
 * in the Rust ring buffer and no IPC happens.
 */
export function ActivitySection({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [unseen, setUnseen] = useState(0);
  // Per-packet logging is expensive enough to matter, so it is opt-in *and*
  // scoped to the panel being open — closing Activity turns it back off.
  const [verbose, setVerbose] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const unlisten = listen<string[]>("log-batch", (e) => {
      if (openRef.current) {
        setLines((prev) => prev.concat(e.payload).slice(-500));
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    void invoke("set_log_streaming", { enabled: open });
    void invoke("set_verbose", { on: open && verbose });
    if (open) {
      setUnseen(0);
      void invoke<string[]>("get_log_buffer").then(setLines);
    } else {
      setLines([]);
    }
  }, [open, verbose]);

  // Poll the buffer length only while closed, once a second, purely to drive
  // the badge. One integer per second is nothing; per-line events were the
  // whole problem.
  useEffect(() => {
    if (open) return;
    const id = window.setInterval(() => {
      void invoke<string[]>("get_log_buffer").then((buf) => setUnseen(buf.length));
    }, 1000);
    return () => window.clearInterval(id);
  }, [open]);

  useLayoutEffect(() => {
    const el = viewRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <Disclosure label="Log" badge={unseen} open={open} onOpenChange={onOpenChange}>
      <label
        className="text-faint hover:text-dim mb-2 flex w-fit cursor-pointer items-center gap-2 text-[9.5px] uppercase transition-colors"
        style={{ letterSpacing: "var(--track-engrave)" }}
      >
        <input
          type="checkbox"
          checked={verbose}
          onChange={(e) => setVerbose(e.target.checked)}
          className="size-3 rounded-[2px] accent-[var(--color-live)]"
        />
        Per-packet
      </label>

      <div
        ref={viewRef}
        className="log-scroll text-dim h-[160px] px-2.5 py-2 text-[10.5px] leading-[1.6]"
      >
        {lines.length === 0 ? (
          /* An empty log is a normal condition, not a missing feature, so it
             says what would fill it rather than apologising for being empty. */
          <p className="text-ghost">
            {"// engine output appears here once the proxy is running"}
          </p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre">
              {line}
            </div>
          ))
        )}
      </div>
    </Disclosure>
  );
}
