import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";

/**
 * `routing.raw`: a JSON object merged into the generated sing-box routing
 * block, for the cases the three lists cannot express.
 *
 * Behind a disclosure because it is an escape hatch, not a setting, and an
 * escape hatch on the face of a screen invites people through it. Unparseable
 * JSON is reported here and blocks the save: the four guard rules that close
 * the SNI-tunnel loop are generated regardless and cannot be overridden from
 * this box, but a malformed object would be rejected by Rust with a much
 * worse message.
 */
export function AdvancedJson({
  value,
  onChange,
  error,
}: {
  /** The raw text, which is not necessarily valid JSON while being typed. */
  value: string;
  onChange: (text: string) => void;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const empty = value.trim() === "";

  return (
    <section className="overflow-hidden rounded-lg border border-hairline bg-card shadow-specular">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-[11px] text-left"
      >
        <Icon
          name="chevron_right"
          size={16}
          className={`text-t3 transition-transform duration-(--dur-fast) ease-(--ease-out) ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="flex-1 text-row font-semibold text-t1">Advanced JSON</span>
        {error ? (
          <Badge tone="bad">invalid</Badge>
        ) : empty ? (
          <Badge>unused</Badge>
        ) : (
          <Badge tone="accent">in use</Badge>
        )}
      </button>

      {open ? (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="border-t border-hairline px-4 pt-3 pb-4"
        >
          <p className="mb-2 text-note leading-[16.5px] text-t2">
            Merged into the generated routing block. The four guard rules that keep the tunnel
            from swallowing the SNI link&rsquo;s own connection are always generated and cannot
            be overridden from here.
          </p>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            dir="ltr"
            aria-label="Raw routing JSON"
            aria-invalid={error ? true : undefined}
            placeholder={'{ "final": "proxy" }'}
            className={`mono pick block h-[120px] w-full resize-none rounded-md border bg-inset px-3 py-[10px] text-note leading-[18px] text-t1 placeholder:text-t4 focus:outline-none ${
              error
                ? "border-bad focus:shadow-[0_0_0_3px_rgba(255,69,58,0.3)]"
                : "border-hairline focus:border-accent focus:shadow-[0_0_0_3px_rgba(0,122,255,0.3)]"
            }`}
          />
          <p className="mt-[6px] min-h-[16px] text-note leading-[16px] text-bad">{error ?? ""}</p>
        </motion.div>
      ) : null}
    </section>
  );
}
