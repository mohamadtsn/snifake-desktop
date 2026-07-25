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
    if (open) {
      setUnseen(0);
      void invoke<string[]>("get_log_buffer").then(setLines);
    } else {
      setLines([]);
    }
  }, [open]);

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
    <Disclosure label="Activity" badge={unseen} open={open} onOpenChange={onOpenChange}>
      <div
        ref={viewRef}
        className="log-scroll h-[168px] p-2.5 font-mono text-[10.5px] leading-[1.55] text-dim"
      >
        {lines.length === 0 ? (
          <div className="text-faint italic">No activity yet.</div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="break-all whitespace-pre-wrap">
              {line}
            </div>
          ))
        )}
      </div>
    </Disclosure>
  );
}
