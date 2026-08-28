import { useRef } from "react";

/**
 * Keystrokes closer together than this collapse into one undo step, the way
 * a native undo stack chunks by word rather than by character. Undoing five
 * times to remove "hello" is not undo, it is punishment.
 */
const COALESCE_MS = 500;

export type UndoHistory = {
  /** Record a value the user just typed. Call from `onChange`. */
  record: (next: string) => void;
  /** The previous value, or undefined when there is nothing left to undo. */
  undo: () => string | undefined;
  /** The value undone most recently, or undefined when there is none. */
  redo: () => string | undefined;
};

/**
 * A per-field undo stack.
 *
 * The browser already has one of these, and in Chrome it works: typing into
 * a controlled React input and pressing Ctrl+Z restores the previous value
 * (verified). Under WebKitGTK, which is what this app actually ships on, it
 * does not. Rather than chase an engine difference we cannot reproduce
 * without a Linux webview, the field owns its own history — which behaves
 * identically on every platform, and adds redo, which the native stack in a
 * controlled input tends to lose anyway.
 *
 * Everything lives in refs: undo state is not rendered, so changing it must
 * not cost a render.
 */
export function useUndoHistory(initial: string): UndoHistory {
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const current = useRef(initial);
  const lastEdit = useRef(0);

  function record(next: string) {
    const now = Date.now();
    // Push a checkpoint only when this edit opens a new burst. Inside a
    // burst the checkpoint already on the stack is the one we want to
    // return to, so the whole burst undoes at once.
    if (past.current.length === 0 || now - lastEdit.current > COALESCE_MS) {
      past.current.push(current.current);
    }
    lastEdit.current = now;
    // Any new edit invalidates the redo branch — the same rule every text
    // editor uses.
    future.current = [];
    current.current = next;
  }

  function undo(): string | undefined {
    const previous = past.current.pop();
    if (previous === undefined) return undefined;
    future.current.push(current.current);
    current.current = previous;
    // An undo ends the burst, so the next keystroke starts a fresh
    // checkpoint instead of merging into whatever preceded it.
    lastEdit.current = 0;
    return previous;
  }

  function redo(): string | undefined {
    const next = future.current.pop();
    if (next === undefined) return undefined;
    past.current.push(current.current);
    current.current = next;
    lastEdit.current = 0;
    return next;
  }

  return { record, undo, redo };
}

/**
 * Reads an undo/redo intent off a keydown. Ctrl/Cmd+Z undoes, and both
 * Ctrl/Cmd+Shift+Z (Unix, macOS) and Ctrl+Y (Windows) redo, because this
 * app ships on all three.
 */
export function undoIntent(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): "undo" | "redo" | null {
  if (!e.ctrlKey && !e.metaKey) return null;
  const key = e.key.toLowerCase();
  if (key === "y") return "redo";
  if (key !== "z") return null;
  return e.shiftKey ? "redo" : "undo";
}
