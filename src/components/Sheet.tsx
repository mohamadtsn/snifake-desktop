import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { rubberband, shouldDismiss, velocityFrom, type Sample } from "@/lib/gesture";

/**
 * Reads the panel's *presentation* translateY, which is where it visually is
 * right now, mid-transition included. Grabbing a sheet that is still closing
 * has to continue from there; without this the panel snaps to its base
 * transform the instant `data-dragging` kills the transition.
 */
function currentTranslateY(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  // Both matrix() and matrix3d() put translateY in the last-but-one slot.
  const parts = t.slice(t.indexOf("(") + 1, -1).split(",");
  const y = Number(parts[parts.length - 1]);
  return Number.isFinite(y) ? y : 0;
}

/**
 * A bottom sheet you can throw away.
 *
 * Base UI's Dialog supplies focus trapping, Esc and scroll lock; the
 * movement is ours, because it has to track the pointer 1:1 and stay
 * interruptible. Deliberately no animation library: the transform is
 * written straight onto the node during the drag, which keeps the whole
 * gesture off the main thread's style pipeline, the thing WebKitGTK is
 * worst at.
 */
export function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const samples = useRef<Sample[]>([]);
  const grabY = useRef(0);
  /** Where the panel already was when the drag started, px. */
  const grabOffset = useRef(0);
  const [dragging, setDragging] = useState(false);
  // Base UI portals to <body> by default, which would put the panel's square
  // bottom corners outside the shell's rounded window corners, over the
  // transparent desktop. Portal into .shell instead: it is `relative` and
  // `overflow-hidden`, so `inset: 0` resolves against it and the corners clip.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => setContainer(document.querySelector<HTMLElement>(".shell")), []);

  function onPointerDown(e: React.PointerEvent) {
    // Ignore extra fingers: switching mid-drag would teleport the sheet.
    if (dragging) return;
    const panel = panelRef.current;
    if (!panel) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grabOffset.current = currentTranslateY(panel);
    // Pin it where it visually is before the transition is removed, so the
    // very next frame does not jump back to the base transform.
    panel.style.transform = `translateY(${grabOffset.current}px)`;
    grabY.current = e.clientY;
    samples.current = [{ y: e.clientY, t: performance.now() }];
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    const panel = panelRef.current;
    if (!dragging || !panel) return;
    samples.current.push({ y: e.clientY, t: performance.now() });
    if (samples.current.length > 12) samples.current.shift();

    const raw = grabOffset.current + (e.clientY - grabY.current);
    // Downward is free; upward resists progressively instead of hitting a
    // wall, because a hard stop reads as the interface having frozen.
    const offset = raw >= 0 ? raw : -rubberband(-raw, panel.clientHeight);
    panel.style.transform = `translateY(${offset}px)`;
  }

  function onPointerUp(e: React.PointerEvent) {
    const panel = panelRef.current;
    if (!dragging || !panel) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);

    const offset = Math.max(0, grabOffset.current + (e.clientY - grabY.current));
    const velocity = velocityFrom(samples.current);
    samples.current = [];
    // Hand back to CSS from wherever the finger left it: the transition
    // starts at the presentation value, so there is no jump.
    panel.style.transform = "";
    if (shouldDismiss(offset, velocity, panel.clientHeight)) onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {/* `contents` so the portal wrapper generates no box of its own and
          does not become a flex item inside .shell. */}
      <Dialog.Portal container={container} className="contents">
        <Dialog.Backdrop className="sheet-backdrop" />
        <Dialog.Popup
          ref={panelRef}
          className="sheet-panel"
          data-dragging={dragging ? "" : undefined}
        >
          <div
            className="sheet-handle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-hidden
          />
          <div className="relative min-h-0 flex-1">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
