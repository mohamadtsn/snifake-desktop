import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion, useReducedMotion } from "motion/react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Toggle } from "@/components/ui/Toggle";
import { logBufferLabel } from "@/lib/readouts";

/**
 * All log state lives here, not in App, so that closing the section unmounts
 * every log line at once. The section also tells the backend whether to bother
 * sending batches at all: while it is closed, the proxy's output accumulates
 * in the Rust ring buffer and no IPC happens.
 *
 * That gate is the reason this application does not peg the CPU while
 * minimized - WebKitGTK keeps running JS and layout for hidden windows, so
 * one Tauri event per stdout line was measurably expensive during a
 * download. None of the effects below may be rewritten for a visual change.
 */
export function ActivitySection({
  open,
  onOpenChange,
  verbose,
  onVerboseChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The user's preference, from the settings store. */
  verbose: boolean;
  onVerboseChange: (on: boolean) => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [copied, setCopied] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const reduce = useReducedMotion();

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
    // Per-packet logging is expensive enough to matter, so the preference is
    // only *in effect* while there is something to read it in: closing the
    // section turns it off at the engine without changing what the user
    // asked for.
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

  async function copy() {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // No clipboard permission under this webview. The lines are selectable,
      // which is the fallback, and a failed copy is not worth a dialog.
    }
  }

  return (
    <Card>
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-[10px]">
          <button
            type="button"
            onClick={() => onOpenChange(!open)}
            aria-expanded={open}
            className="flex min-w-0 items-center gap-2 rounded-sm text-left"
          >
            <Icon
              name="chevron_right"
              size={16}
              className={`text-t3 transition-transform duration-(--dur-fast) ease-(--ease-out) ${
                open ? "rotate-90" : ""
              }`}
            />
            <span className="truncate text-row font-semibold text-t1">Live telemetry log</span>
            <Badge tone={unseen > 0 && !open ? "accent" : "neutral"}>
              {logBufferLabel(open ? lines.length : unseen)}
            </Badge>
          </button>

          <div className="flex shrink-0 items-center gap-3">
            <label className="flex items-center gap-2 text-note text-t2">
              Per-packet
              <Toggle
                size="sm"
                checked={verbose}
                onChange={onVerboseChange}
                aria-label="Per-packet engine logging"
              />
            </label>
            <button
              type="button"
              onClick={() => void copy()}
              disabled={lines.length === 0}
              aria-label="Copy the log"
              title={copied ? "Copied" : "Copy the log"}
              className="flex size-[26px] items-center justify-center rounded-sm text-t3 transition-[background-color,color] duration-(--dur-press) ease-(--ease-out) hover:bg-raised-dim hover:text-t1 disabled:pointer-events-none disabled:opacity-40"
            >
              <Icon name={copied ? "check" : "content_copy"} size={14} />
            </button>
          </div>
        </div>

        {/* Conditional, not hidden: 500 log lines stay out of the DOM while
            the section is closed, which is half the reason the gate exists. */}
        {open ? (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="px-4 pb-4"
          >
            <div
              ref={viewRef}
              className="log-lines pick mono h-[172px] rounded-md border border-hairline bg-inset px-3 py-[10px] text-note leading-[18px] text-t2"
            >
              {lines.length === 0 ? (
                /* An empty log is a normal condition, not a missing feature,
                   so it says what would fill it rather than apologising. */
                <p className="text-t3">
                  {"// engine output appears here once the SNI link is running"}
                </p>
              ) : (
                lines.map((line, i) => <div key={i}>{line}</div>)
              )}
            </div>
          </motion.div>
        ) : null}
      </div>
    </Card>
  );
}
