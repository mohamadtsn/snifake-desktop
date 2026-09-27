import type { ReactNode } from "react";

/** An engraved section label over one grouped list. The label is what says
 *  which kind of thing the rows below it are, which is why the rows can be
 *  one group rather than a stack of separate cards. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="px-[2px] text-note font-semibold tracking-[0.55px] text-t2 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
